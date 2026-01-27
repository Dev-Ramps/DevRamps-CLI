/**
 * Bootstrap command implementation
 *
 * This is the main command that:
 * 1. Checks for AWS credentials
 * 2. Authenticates with DevRamps via browser
 * 3. Parses pipeline definitions
 * 4. Deploys CloudFormation stacks to target accounts
 */

import ora from 'ora';
import { getCurrentIdentity } from '../aws/credentials.js';
import { assumeRoleForAccount } from '../aws/assume-role.js';
import { deployStack, getStackStatus } from '../aws/cloudformation.js';
import { checkOidcProviderExists } from '../aws/oidc-provider.js';
import { authenticateViaBrowser } from '../auth/browser-auth.js';
import { findDevrampsPipelines, parsePipeline } from '../parsers/pipeline.js';
import { generateBootstrapTemplate, getStackName } from '../templates/bootstrap-stack.js';
import { DevRampsError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { setVerbose } from '../utils/logger.js';
import { confirmDeployment, confirmDryRun } from '../utils/prompts.js';
import type { BootstrapOptions, DeploymentPlan, StackDeployment } from '../types/config.js';
import type { ParsedPipeline } from '../types/pipeline.js';

export async function bootstrapCommand(options: BootstrapOptions): Promise<void> {
  try {
    // Set verbose mode
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

    // Step 3: Find and parse pipelines
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
    for (const slug of pipelineSlugs) {
      const pipeline = await parsePipeline(basePath, slug);
      pipelines.push(pipeline);
    }

    spinner.succeed(`Found ${pipelines.length} pipeline(s)`);

    // Step 4: Build deployment plan
    spinner.start('Building deployment plan...');
    const plan = await buildDeploymentPlan(
      pipelines,
      authData.orgSlug,
      identity.accountId,
      options.targetAccountRoleName
    );
    spinner.succeed('Deployment plan ready');

    // Step 5: Handle dry run or actual deployment
    if (options.dryRun) {
      await confirmDryRun(plan);
      return;
    }

    // Step 6: Confirm with user
    const confirmed = await confirmDeployment(plan);
    if (!confirmed) {
      logger.info('Deployment cancelled by user.');
      return;
    }

    // Step 7: Execute deployment
    logger.newline();
    logger.header('Deploying Stacks');

    let successCount = 0;
    let failCount = 0;

    for (const stack of plan.stacks) {
      const stackSpinner = ora(`Deploying ${stack.stackName} to ${stack.accountId}...`).start();

      try {
        await deployStackToAccount(
          stack,
          pipelines.find(p => p.slug === stack.pipelineSlug)!,
          authData.orgSlug,
          identity.accountId,
          options.targetAccountRoleName
        );
        stackSpinner.succeed(`${stack.stackName} deployed to ${stack.accountId}`);
        successCount++;
      } catch (error) {
        stackSpinner.fail(`${stack.stackName} failed: ${error instanceof Error ? error.message : String(error)}`);
        failCount++;
      }
    }

    // Summary
    logger.newline();
    logger.header('Deployment Summary');

    if (failCount === 0) {
      logger.success(`All ${successCount} stack(s) deployed successfully!`);
    } else {
      logger.warn(`${successCount} stack(s) succeeded, ${failCount} stack(s) failed.`);
    }

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

async function buildDeploymentPlan(
  pipelines: ParsedPipeline[],
  orgSlug: string,
  currentAccountId: string,
  targetRoleName?: string
): Promise<DeploymentPlan> {
  const stacks: StackDeployment[] = [];

  for (const pipeline of pipelines) {
    for (const accountId of pipeline.targetAccountIds) {
      const stackName = getStackName(pipeline.slug);

      // Check if stack exists to determine CREATE vs UPDATE
      let action: 'CREATE' | 'UPDATE' = 'CREATE';

      try {
        // Try to check stack status if we can access the account
        const credentials = accountId !== currentAccountId
          ? (await assumeRoleForAccount({
              targetAccountId: accountId,
              currentAccountId,
              targetRoleName,
            }))?.credentials
          : undefined;

        const status = await getStackStatus(stackName, credentials);
        if (status.exists) {
          action = 'UPDATE';
        }
      } catch {
        // If we can't check, assume CREATE (we'll fail during deployment if role assumption fails)
        logger.verbose(`Could not check stack status for ${accountId}, assuming CREATE`);
      }

      stacks.push({
        accountId,
        pipelineSlug: pipeline.slug,
        stackName,
        action,
        steps: pipeline.steps.map(s => s.name),
        additionalPoliciesCount: pipeline.additionalPolicies.length,
      });
    }
  }

  return {
    orgSlug,
    stacks,
  };
}

async function deployStackToAccount(
  stack: StackDeployment,
  pipeline: ParsedPipeline,
  orgSlug: string,
  currentAccountId: string,
  targetRoleName?: string
): Promise<void> {
  // Get credentials for the target account
  const assumedRole = await assumeRoleForAccount({
    targetAccountId: stack.accountId,
    currentAccountId,
    targetRoleName,
  });

  const credentials = assumedRole?.credentials;

  // Check if OIDC provider exists
  const oidcInfo = await checkOidcProviderExists(credentials);

  // Generate the template
  const template = generateBootstrapTemplate({
    pipelineSlug: pipeline.slug,
    orgSlug,
    steps: pipeline.steps,
    additionalPolicies: pipeline.additionalPolicies,
    accountId: stack.accountId,
  });

  // If OIDC provider exists, set the parameter
  if (oidcInfo.exists) {
    logger.verbose(`OIDC provider already exists in ${stack.accountId}`);
    // The template uses a condition based on a parameter
    // We'd need to pass this as a stack parameter
  }

  // Deploy the stack
  await deployStack({
    stackName: stack.stackName,
    template,
    accountId: stack.accountId,
    credentials,
  });
}
