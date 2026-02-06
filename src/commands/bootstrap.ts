/**
 * Bootstrap command implementation
 *
 * Deploys a four-stack model:
 * 1. Org Stack - One per org in CI/CD account (OIDC, org role, KMS, Terraform state)
 * 2. Pipeline Stacks - One per pipeline in CI/CD account (root ECR/S3 for artifacts)
 * 3. Account Stacks - One per account (OIDC provider only - must be unique per account)
 * 4. Stage Stacks - One per stage in stage's account/region (stage role, mirrored ECR/S3)
 */

import ora from 'ora';
import { getCurrentIdentity } from '../aws/credentials.js';
import { assumeRoleForAccount } from '../aws/assume-role.js';
import { deployStack, getStackStatus, readExistingStack, previewStackChanges } from '../aws/cloudformation.js';
import { authenticateViaBrowser } from '../auth/browser-auth.js';
import { findDevrampsPipelines, parsePipeline } from '../parsers/pipeline.js';
import { parseArtifacts, filterArtifactsForPipelineStack } from '../parsers/artifacts.js';
import { generateOrgStackTemplate, getOrgStackName } from '../templates/org-stack.js';
import { generatePipelineStackTemplate, getPipelineStackName } from '../templates/pipeline-stack.js';
import { generateAccountStackTemplate, getAccountStackName } from '../templates/account-stack.js';
import { generateStageStackTemplate, getStageStackName } from '../templates/stage-stack.js';
import { generateTerraformStateBucketName } from '../naming/index.js';
import { getBucketPolicyStrategy, type BucketPolicyData } from '../merge/index.js';
import { DevRampsError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { setVerbose, getMultiStackProgress, clearMultiStackProgress } from '../utils/logger.js';
import { confirmDeployment, confirmDryRun } from '../utils/prompts.js';
import type { BootstrapOptions, AuthData } from '../types/config.js';
import type { ParsedPipeline } from '../types/pipeline.js';
import {
  StackType,
  type DeploymentPlan,
  type OrgStackDeployment,
  type PipelineStackDeployment,
  type AccountStackDeployment,
  type StageStackDeployment,
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
 * Build the complete deployment plan for all stack types
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
    stackType: StackType.ORG,
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
      stackType: StackType.PIPELINE,
      stackName,
      accountId: cicdAccountId,
      region: cicdRegion,
      action: await determineStackAction(stackName, cicdCredentials, cicdRegion),
      pipelineSlug: pipeline.slug,
      dockerArtifacts: filteredArtifacts.docker,
      bundleArtifacts: filteredArtifacts.bundle,
    });
  }

  // 3. Account Stacks (one per unique account for OIDC provider)
  //    The CI/CD account must always be included since the Org stack relies
  //    on the OIDC provider created by the Account Bootstrap stack.
  const accountStacks: AccountStackDeployment[] = [];
  const accountStackName = getAccountStackName();

  // Track accounts we've already added to avoid duplicates
  const accountsWithStacks = new Set<string>();

  // Always include the CI/CD account first (Org stack depends on its OIDC provider)
  accountsWithStacks.add(cicdAccountId);
  accountStacks.push({
    stackType: StackType.ACCOUNT,
    stackName: accountStackName,
    accountId: cicdAccountId,
    region: cicdRegion,
    action: await determineStackAction(accountStackName, cicdCredentials, cicdRegion),
  });

  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      // Skip if we already have an account stack for this account
      if (accountsWithStacks.has(stage.account_id)) {
        continue;
      }
      accountsWithStacks.add(stage.account_id);

      // Try to get credentials for this account
      let accountCredentials;
      try {
        if (stage.account_id !== currentAccountId) {
          const assumed = await assumeRoleForAccount({
            targetAccountId: stage.account_id,
            currentAccountId,
            targetRoleName,
          });
          accountCredentials = assumed?.credentials;
        }
      } catch {
        logger.verbose(`Could not assume role in ${stage.account_id} for status check`);
      }

      accountStacks.push({
        stackType: StackType.ACCOUNT,
        stackName: accountStackName,
        accountId: stage.account_id,
        region: cicdRegion, // Deploy in CI/CD region for consistency
        action: await determineStackAction(accountStackName, accountCredentials, cicdRegion),
      });
    }
  }

  // 4. Stage Stacks
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
        stackType: StackType.STAGE,
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
    accountStacks,
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
  logger.info('Org Stack:');
  logger.info(`  ${plan.orgStack.action}: ${plan.orgStack.stackName}`);
  logger.info(`    Account: ${plan.orgStack.accountId}, Region: ${plan.orgStack.region}`);
  logger.info(`    Target accounts with bucket access: ${plan.orgStack.targetAccountIds.length}`);

  if (plan.pipelineStacks.length > 0) {
    logger.newline();
    logger.info('Pipeline Stacks:');
    for (const stack of plan.pipelineStacks) {
      logger.info(`  ${stack.action}: ${stack.stackName}`);
      logger.info(`    Account: ${stack.accountId}, Region: ${stack.region}`);
      logger.info(`    ECR repos: ${stack.dockerArtifacts.length}, S3 buckets: ${stack.bundleArtifacts.length}`);
    }
  }

  if (plan.accountStacks.length > 0) {
    logger.newline();
    logger.info('Account Stacks:');
    for (const stack of plan.accountStacks) {
      logger.info(`  ${stack.action}: ${stack.stackName}`);
      logger.info(`    Account: ${stack.accountId}, Region: ${stack.region} (OIDC provider)`);
    }
  }

  if (plan.stageStacks.length > 0) {
    logger.newline();
    logger.info('Stage Stacks:');
    for (const stack of plan.stageStacks) {
      logger.info(`  ${stack.action}: ${stack.stackName}`);
      logger.info(`    Account: ${stack.accountId}, Region: ${stack.region}`);
      logger.info(`    ECR repos: ${stack.dockerArtifacts.length}, S3 buckets: ${stack.bundleArtifacts.length}`);
    }
  }

  const totalStacks = 1 + plan.pipelineStacks.length + plan.accountStacks.length + plan.stageStacks.length;
  logger.newline();
  logger.info(`Total stacks to deploy (in parallel): ${totalStacks}`);
}

/**
 * Confirm deployment with user
 */
async function confirmDeploymentPlan(plan: DeploymentPlan): Promise<boolean> {
  const totalStacks = 1 + plan.pipelineStacks.length + plan.accountStacks.length + plan.stageStacks.length;

  logger.newline();
  logger.info(`About to deploy ${totalStacks} stack(s):`);
  logger.info(`  - 1 Org stack (${plan.orgStack.action})`);
  logger.info(`  - ${plan.pipelineStacks.length} Pipeline stack(s)`);
  logger.info(`  - ${plan.accountStacks.length} Account stack(s) (OIDC provider)`);
  logger.info(`  - ${plan.stageStacks.length} Stage stack(s)`);

  // Use the existing confirmDeployment prompt
  // This returns boolean based on user input
  return confirmDeployment({
    orgSlug: plan.orgSlug,
    stacks: [
      { ...plan.orgStack, pipelineSlug: 'org', steps: [], additionalPoliciesCount: 0 },
      ...plan.pipelineStacks.map(s => ({ ...s, steps: [], additionalPoliciesCount: 0 })),
      ...plan.accountStacks.map(s => ({ ...s, pipelineSlug: 'account', steps: [], additionalPoliciesCount: 0 })),
      ...plan.stageStacks.map(s => ({ ...s, steps: s.steps.map(st => st.name), additionalPoliciesCount: s.additionalPolicies.length })),
    ],
  });
}

/**
 * Execute deployment of all stacks in parallel
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

  const totalStacks = 1 + plan.pipelineStacks.length + plan.accountStacks.length + plan.stageStacks.length;

  logger.newline();
  logger.header('Deploying All Stacks');
  logger.info(`Deploying ${totalStacks} stack(s) in parallel...`);
  logger.newline();

  // Initialize multi-stack progress display
  const progress = getMultiStackProgress();

  // Register all stacks with estimated resource counts and types
  progress.addStack(plan.orgStack.stackName, 'org', plan.orgStack.accountId, plan.orgStack.region, 5);
  for (const stack of plan.pipelineStacks) {
    const resourceCount = stack.dockerArtifacts.length + stack.bundleArtifacts.length;
    progress.addStack(stack.stackName, 'pipeline', stack.accountId, stack.region, Math.max(resourceCount, 1));
  }
  for (const stack of plan.accountStacks) {
    progress.addStack(stack.stackName, 'account', stack.accountId, stack.region, 1);
  }
  for (const stack of plan.stageStacks) {
    const resourceCount = stack.dockerArtifacts.length + stack.bundleArtifacts.length + 2;
    progress.addStack(stack.stackName, 'stage', stack.accountId, stack.region, resourceCount);
  }

  // Start the progress display (enters alternate screen)
  progress.start();

  // Create deployment promises for all stacks
  const orgPromise = (async () => {
    try {
      await deployOrgStack(plan, pipelines, authData, currentAccountId, options);
      return { stack: plan.orgStack.stackName, success: true };
    } catch (error) {
      return {
        stack: plan.orgStack.stackName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  const pipelinePromises = plan.pipelineStacks.map(async (stack) => {
    try {
      await deployPipelineStack(stack, authData, currentAccountId, options);
      return { stack: stack.stackName, success: true };
    } catch (error) {
      return {
        stack: stack.stackName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const accountPromises = plan.accountStacks.map(async (stack) => {
    try {
      await deployAccountStack(stack, currentAccountId, options);
      return { stack: stack.stackName, success: true };
    } catch (error) {
      return {
        stack: stack.stackName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const stagePromises = plan.stageStacks.map(async (stack) => {
    try {
      await deployStageStack(stack, authData, currentAccountId, options);
      return { stack: stack.stackName, success: true };
    } catch (error) {
      return {
        stack: stack.stackName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Wait for all stacks to complete
  const allResults = await Promise.all([
    orgPromise,
    ...pipelinePromises,
    ...accountPromises,
    ...stagePromises,
  ]);

  // Clear progress display
  clearMultiStackProgress();

  // Process results
  logger.newline();
  for (const result of allResults) {
    if (result.success) {
      logger.success(`${result.stack} deployed`);
      results.success++;
    } else {
      logger.error(`${result.stack} failed: ${result.error}`);
      results.failed++;
    }
  }

  // Summary
  logger.newline();
  logger.header('Deployment Summary');

  if (results.failed === 0) {
    logger.success(`All ${results.success} stack(s) deployed successfully!`);
    process.exit(0);
  } else {
    logger.warn(`${results.success} stack(s) succeeded, ${results.failed} stack(s) failed.`);
    process.exit(1);
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
 * Deploy an account bootstrap stack (creates OIDC provider)
 */
async function deployAccountStack(
  stack: AccountStackDeployment,
  currentAccountId: string,
  options: BootstrapOptions
): Promise<void> {
  // Get credentials for target account
  const credentials = stack.accountId !== currentAccountId
    ? (await assumeRoleForAccount({
        targetAccountId: stack.accountId,
        currentAccountId,
        targetRoleName: options.targetAccountRoleName,
      }))?.credentials
    : undefined;

  // Generate template
  const template = generateAccountStackTemplate();

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

  // Note: OIDC provider is created by the Account Bootstrap stack (deployed in Phase 2)

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
