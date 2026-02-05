/**
 * Bootstrap command implementation
 *
 * Deploys a three-stack model:
 * 1. Org Stack - One per org in CI/CD account (OIDC, org role, KMS, Terraform state)
 * 2. Pipeline Stacks - One per pipeline in CI/CD account (root ECR/S3 for artifacts)
 * 3. Stage Stacks - One per stage in stage's account/region (stage role, mirrored ECR/S3)
 */

import ora from 'ora';
import { getCurrentIdentity } from '../aws/credentials.js';
import { assumeRoleForAccount } from '../aws/assume-role.js';
import { deployStack, getStackStatus, readExistingStack, previewStackChanges } from '../aws/cloudformation.js';
import { checkOidcProviderExists } from '../aws/oidc-provider.js';
import { authenticateViaBrowser } from '../auth/browser-auth.js';
import { findDevrampsPipelines, parsePipeline } from '../parsers/pipeline.js';
import { parseArtifacts, filterArtifactsForPipelineStack } from '../parsers/artifacts.js';
import { generateOrgStackTemplate, getOrgStackName } from '../templates/org-stack.js';
import { generatePipelineStackTemplate, getPipelineStackName } from '../templates/pipeline-stack.js';
import { generateStageStackTemplate, getStageStackName } from '../templates/stage-stack.js';
import { generateTerraformStateBucketName } from '../naming/index.js';
import { getBucketPolicyStrategy, type BucketPolicyData } from '../merge/index.js';
import { DevRampsError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { setVerbose } from '../utils/logger.js';
import { confirmDeployment, confirmDryRun } from '../utils/prompts.js';
import type { BootstrapOptions, AuthData } from '../types/config.js';
import type { ParsedPipeline } from '../types/pipeline.js';
import type {
  DeploymentPlan,
  OrgStackDeployment,
  PipelineStackDeployment,
  StageStackDeployment,
  StackType,
} from '../types/stacks.js';
import type { ParsedArtifacts } from '../types/artifacts.js';

export async function bootstrapCommand(options: BootstrapOptions): Promise<void> {
  try {
    if (options.verbose) {
      setVerbose(true);
    }

    logger.header('DevRamps Bootstrap');

    // Step 1: Check AWS credentials
    const spinner = ora('Checking AWS credentials...').start();
    const identity = await getCurrentIdentity();
    spinner.succeed(`Authenticated as ${identity.arn}`);

    // Step 2: Authenticate with DevRamps
    const authData = await authenticateViaBrowser({
      endpointOverride: options.endpointOverride,
    });

    // Step 3: Find and parse ALL pipelines (needed for org stack bucket policy merge)
    spinner.start('Finding pipelines...');
    const basePath = process.cwd();
    const filterSlugs = options.pipelineSlugs
      ? options.pipelineSlugs.split(',').map(s => s.trim())
      : undefined;

    const pipelineSlugs = await findDevrampsPipelines(basePath, filterSlugs);

    if (pipelineSlugs.length === 0) {
      spinner.fail('No pipelines found');
      logger.error('No pipeline.yaml files found in .devramps/ folder.');
      process.exit(1);
    }

    spinner.text = `Parsing ${pipelineSlugs.length} pipeline(s)...`;

    const pipelines: ParsedPipeline[] = [];
    const pipelineArtifacts: Map<string, ParsedArtifacts> = new Map();

    for (const slug of pipelineSlugs) {
      const pipeline = await parsePipeline(basePath, slug);
      pipelines.push(pipeline);

      // Parse artifacts for this pipeline
      const artifacts = parseArtifacts(pipeline.definition);
      pipelineArtifacts.set(slug, artifacts);
    }

    spinner.succeed(`Found ${pipelines.length} pipeline(s)`);

    // Step 4: Build deployment plan
    spinner.start('Building deployment plan...');
    const plan = await buildDeploymentPlan(
      pipelines,
      pipelineArtifacts,
      authData,
      identity.accountId,
      options.targetAccountRoleName
    );
    spinner.succeed('Deployment plan ready');

    // Step 5: Handle dry run or actual deployment
    if (options.dryRun) {
      await showDryRunPlan(plan);
      return;
    }

    // Step 6: Confirm with user
    const confirmed = await confirmDeploymentPlan(plan);
    if (!confirmed) {
      logger.info('Deployment cancelled by user.');
      return;
    }

    // Step 7: Execute three-phase deployment
    await executeDeployment(plan, pipelines, pipelineArtifacts, authData, identity.accountId, options);

  } catch (error) {
    if (error instanceof DevRampsError) {
      logger.error(error.message);
      process.exit(1);
    }

    logger.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    if (logger.isVerbose() && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Build the complete deployment plan for all three stack types
 */
async function buildDeploymentPlan(
  pipelines: ParsedPipeline[],
  pipelineArtifacts: Map<string, ParsedArtifacts>,
  authData: AuthData,
  currentAccountId: string,
  targetRoleName?: string
): Promise<DeploymentPlan> {
  const { orgSlug, cicdAccountId, cicdRegion } = authData;

  // Collect all target accounts across all pipelines (for org stack)
  const allTargetAccountIds = new Set<string>();
  for (const pipeline of pipelines) {
    for (const accountId of pipeline.targetAccountIds) {
      allTargetAccountIds.add(accountId);
    }
  }

  // Try to get credentials for CI/CD account
  let cicdCredentials;
  try {
    if (cicdAccountId !== currentAccountId) {
      const assumed = await assumeRoleForAccount({
        targetAccountId: cicdAccountId,
        currentAccountId,
        targetRoleName,
      });
      cicdCredentials = assumed?.credentials;
    }
  } catch {
    logger.verbose('Could not assume role in CI/CD account for status check');
  }

  // 1. Org Stack
  const orgStackName = getOrgStackName(orgSlug);
  const orgStack: OrgStackDeployment = {
    stackType: 'Org' as StackType.ORG,
    stackName: orgStackName,
    accountId: cicdAccountId,
    region: cicdRegion,
    action: await determineStackAction(orgStackName, cicdCredentials, cicdRegion),
    orgSlug,
    targetAccountIds: Array.from(allTargetAccountIds),
  };

  // 2. Pipeline Stacks
  const pipelineStacks: PipelineStackDeployment[] = [];
  for (const pipeline of pipelines) {
    const artifacts = pipelineArtifacts.get(pipeline.slug)!;
    const filteredArtifacts = filterArtifactsForPipelineStack(artifacts);
    const stackName = getPipelineStackName(pipeline.slug);

    pipelineStacks.push({
      stackType: 'Pipeline' as StackType.PIPELINE,
      stackName,
      accountId: cicdAccountId,
      region: cicdRegion,
      action: await determineStackAction(stackName, cicdCredentials, cicdRegion),
      pipelineSlug: pipeline.slug,
      dockerArtifacts: filteredArtifacts.docker,
      bundleArtifacts: filteredArtifacts.bundle,
    });
  }

  // 3. Stage Stacks
  const stageStacks: StageStackDeployment[] = [];
  for (const pipeline of pipelines) {
    const artifacts = pipelineArtifacts.get(pipeline.slug)!;

    for (const stage of pipeline.stages) {
      const stackName = getStageStackName(pipeline.slug, stage.name);

      // Try to get credentials for this stage account
      let stageCredentials;
      try {
        if (stage.account_id !== currentAccountId) {
          const assumed = await assumeRoleForAccount({
            targetAccountId: stage.account_id,
            currentAccountId,
            targetRoleName,
          });
          stageCredentials = assumed?.credentials;
        }
      } catch {
        logger.verbose(`Could not assume role in ${stage.account_id} for status check`);
      }

      stageStacks.push({
        stackType: 'Stage' as StackType.STAGE,
        stackName,
        accountId: stage.account_id,
        region: stage.region,
        action: await determineStackAction(stackName, stageCredentials, stage.region),
        pipelineSlug: pipeline.slug,
        stageName: stage.name,
        orgSlug,
        steps: pipeline.steps,
        additionalPolicies: pipeline.additionalPolicies,
        dockerArtifacts: artifacts.docker,
        bundleArtifacts: artifacts.bundle,
      });
    }
  }

  return {
    orgSlug,
    cicdAccountId,
    cicdRegion,
    orgStack,
    pipelineStacks,
    stageStacks,
  };
}

/**
 * Determine if a stack should be created or updated
 */
async function determineStackAction(
  stackName: string,
  credentials: Awaited<ReturnType<typeof assumeRoleForAccount>>['credentials'] | undefined,
  region: string
): Promise<'CREATE' | 'UPDATE'> {
  try {
    const status = await getStackStatus(stackName, credentials, region);
    return status.exists ? 'UPDATE' : 'CREATE';
  } catch {
    return 'CREATE';
  }
}

/**
 * Show dry run plan
 */
async function showDryRunPlan(plan: DeploymentPlan): Promise<void> {
  logger.newline();
  logger.header('Deployment Plan (Dry Run)');

  logger.info(`Organization: ${plan.orgSlug}`);
  logger.info(`CI/CD Account: ${plan.cicdAccountId}`);
  logger.info(`CI/CD Region: ${plan.cicdRegion}`);

  logger.newline();
  logger.info('Phase 1: Org Stack');
  logger.info(`  ${plan.orgStack.action}: ${plan.orgStack.stackName}`);
  logger.info(`    Account: ${plan.orgStack.accountId}`);
  logger.info(`    Target accounts with bucket access: ${plan.orgStack.targetAccountIds.length}`);

  logger.newline();
  logger.info('Phase 2: Pipeline Stacks');
  for (const stack of plan.pipelineStacks) {
    logger.info(`  ${stack.action}: ${stack.stackName}`);
    logger.info(`    ECR repos: ${stack.dockerArtifacts.length}, S3 buckets: ${stack.bundleArtifacts.length}`);
  }

  logger.newline();
  logger.info('Phase 3: Stage Stacks');
  for (const stack of plan.stageStacks) {
    logger.info(`  ${stack.action}: ${stack.stackName}`);
    logger.info(`    Account: ${stack.accountId}, Region: ${stack.region}`);
    logger.info(`    ECR repos: ${stack.dockerArtifacts.length}, S3 buckets: ${stack.bundleArtifacts.length}`);
  }

  const totalStacks = 1 + plan.pipelineStacks.length + plan.stageStacks.length;
  logger.newline();
  logger.info(`Total stacks to deploy: ${totalStacks}`);
}

/**
 * Confirm deployment with user
 */
async function confirmDeploymentPlan(plan: DeploymentPlan): Promise<boolean> {
  const totalStacks = 1 + plan.pipelineStacks.length + plan.stageStacks.length;

  logger.newline();
  logger.info(`About to deploy ${totalStacks} stack(s):`);
  logger.info(`  - 1 Org stack (${plan.orgStack.action})`);
  logger.info(`  - ${plan.pipelineStacks.length} Pipeline stack(s)`);
  logger.info(`  - ${plan.stageStacks.length} Stage stack(s)`);

  // Use the existing confirmDeployment prompt
  // This returns boolean based on user input
  return confirmDeployment({
    orgSlug: plan.orgSlug,
    stacks: [
      { ...plan.orgStack, pipelineSlug: 'org', steps: [], additionalPoliciesCount: 0 },
      ...plan.pipelineStacks.map(s => ({ ...s, steps: [], additionalPoliciesCount: 0 })),
      ...plan.stageStacks.map(s => ({ ...s, steps: s.steps.map(st => st.name), additionalPoliciesCount: s.additionalPolicies.length })),
    ],
  });
}

/**
 * Execute the three-phase deployment
 */
async function executeDeployment(
  plan: DeploymentPlan,
  pipelines: ParsedPipeline[],
  pipelineArtifacts: Map<string, ParsedArtifacts>,
  authData: AuthData,
  currentAccountId: string,
  options: BootstrapOptions
): Promise<void> {
  const results = { success: 0, failed: 0 };

  // PHASE 1: Deploy Org Stack (must succeed before continuing)
  logger.newline();
  logger.header('Phase 1: Org Stack');

  try {
    await deployOrgStack(plan, pipelines, authData, currentAccountId, options);
    results.success++;
    logger.success('Org stack deployed successfully');
  } catch (error) {
    results.failed++;
    logger.error(`Org stack failed: ${error instanceof Error ? error.message : String(error)}`);
    // Critical failure - cannot continue without org stack
    throw error;
  }

  // PHASE 2: Deploy Pipeline Stacks (can be parallel, but doing sequential for clarity)
  logger.newline();
  logger.header('Phase 2: Pipeline Stacks');

  for (const stack of plan.pipelineStacks) {
    const spinner = ora(`Deploying ${stack.stackName}...`).start();

    try {
      await deployPipelineStack(stack, authData, currentAccountId, options);
      spinner.succeed(`${stack.stackName} deployed`);
      results.success++;
    } catch (error) {
      spinner.fail(`${stack.stackName} failed: ${error instanceof Error ? error.message : String(error)}`);
      results.failed++;
    }
  }

  // PHASE 3: Deploy Stage Stacks (can be parallel, but doing sequential for clarity)
  logger.newline();
  logger.header('Phase 3: Stage Stacks');

  for (const stack of plan.stageStacks) {
    const spinner = ora(`Deploying ${stack.stackName} to ${stack.accountId}/${stack.region}...`).start();

    try {
      await deployStageStack(stack, authData, currentAccountId, options);
      spinner.succeed(`${stack.stackName} deployed to ${stack.accountId}`);
      results.success++;
    } catch (error) {
      spinner.fail(`${stack.stackName} failed: ${error instanceof Error ? error.message : String(error)}`);
      results.failed++;
    }
  }

  // Summary
  logger.newline();
  logger.header('Deployment Summary');

  if (results.failed === 0) {
    logger.success(`All ${results.success} stack(s) deployed successfully!`);
  } else {
    logger.warn(`${results.success} stack(s) succeeded, ${results.failed} stack(s) failed.`);
  }
}

/**
 * Deploy the org stack with bucket policy merging
 */
async function deployOrgStack(
  plan: DeploymentPlan,
  pipelines: ParsedPipeline[],
  authData: AuthData,
  currentAccountId: string,
  options: BootstrapOptions
): Promise<void> {
  const { orgSlug, cicdAccountId, cicdRegion } = authData;

  // Get credentials for CI/CD account
  const credentials = cicdAccountId !== currentAccountId
    ? (await assumeRoleForAccount({
        targetAccountId: cicdAccountId,
        currentAccountId,
        targetRoleName: options.targetAccountRoleName,
      }))?.credentials
    : undefined;

  // Execute bucket policy merge if stack exists
  let targetAccountIds = plan.orgStack.targetAccountIds;

  if (plan.orgStack.action === 'UPDATE') {
    logger.verbose('Merging bucket policy with existing accounts...');

    const bucketName = generateTerraformStateBucketName(orgSlug);
    const strategy = getBucketPolicyStrategy();
    strategy.configure(bucketName, cicdRegion, credentials);

    const existingStack = await readExistingStack(
      plan.orgStack.stackName,
      cicdAccountId,
      cicdRegion,
      credentials
    );

    if (existingStack) {
      const existing = await strategy.extractExisting(existingStack);
      const newData: BucketPolicyData = { allowedAccountIds: targetAccountIds };
      const merged = strategy.merge(existing, newData);
      targetAccountIds = merged.allowedAccountIds;

      logger.verbose(`Merged ${targetAccountIds.length} account(s) into bucket policy`);
    }
  }

  // Generate template with merged data
  const template = generateOrgStackTemplate({
    orgSlug,
    cicdAccountId,
    targetAccountIds,
  });

  const deployOptions = {
    stackName: plan.orgStack.stackName,
    template,
    accountId: cicdAccountId,
    region: cicdRegion,
    credentials,
  };

  // Preview changes
  await previewStackChanges(deployOptions);

  // Deploy
  await deployStack(deployOptions);
}

/**
 * Deploy a pipeline stack
 */
async function deployPipelineStack(
  stack: PipelineStackDeployment,
  authData: AuthData,
  currentAccountId: string,
  options: BootstrapOptions
): Promise<void> {
  const { cicdAccountId, cicdRegion } = authData;

  // Get credentials for CI/CD account
  const credentials = cicdAccountId !== currentAccountId
    ? (await assumeRoleForAccount({
        targetAccountId: cicdAccountId,
        currentAccountId,
        targetRoleName: options.targetAccountRoleName,
      }))?.credentials
    : undefined;

  // Generate template
  const template = generatePipelineStackTemplate({
    pipelineSlug: stack.pipelineSlug,
    cicdAccountId,
    dockerArtifacts: stack.dockerArtifacts,
    bundleArtifacts: stack.bundleArtifacts,
  });

  const deployOptions = {
    stackName: stack.stackName,
    template,
    accountId: cicdAccountId,
    region: cicdRegion,
    credentials,
  };

  // Preview changes
  await previewStackChanges(deployOptions);

  // Deploy
  await deployStack(deployOptions);
}

/**
 * Deploy a stage stack
 */
async function deployStageStack(
  stack: StageStackDeployment,
  authData: AuthData,
  currentAccountId: string,
  options: BootstrapOptions
): Promise<void> {
  // Get credentials for stage account
  const credentials = stack.accountId !== currentAccountId
    ? (await assumeRoleForAccount({
        targetAccountId: stack.accountId,
        currentAccountId,
        targetRoleName: options.targetAccountRoleName,
      }))?.credentials
    : undefined;

  // Check if OIDC provider exists
  const oidcInfo = await checkOidcProviderExists(credentials, stack.region);
  logger.verbose(`OIDC provider in ${stack.accountId}: ${oidcInfo.exists ? 'exists' : 'will be created'}`);

  // Generate template
  const template = generateStageStackTemplate({
    pipelineSlug: stack.pipelineSlug,
    stageName: stack.stageName,
    orgSlug: stack.orgSlug,
    accountId: stack.accountId,
    steps: stack.steps,
    additionalPolicies: stack.additionalPolicies,
    dockerArtifacts: stack.dockerArtifacts,
    bundleArtifacts: stack.bundleArtifacts,
  });

  const deployOptions = {
    stackName: stack.stackName,
    template,
    accountId: stack.accountId,
    region: stack.region,
    credentials,
  };

  // Preview changes
  await previewStackChanges(deployOptions);

  // Deploy
  await deployStack(deployOptions);
}
