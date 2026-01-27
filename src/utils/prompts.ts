/**
 * User prompts and confirmations
 */

import inquirer from 'inquirer';
import * as logger from './logger.js';
import type { DeploymentPlan, StackDeployment } from '../types/config.js';

export async function confirmDeployment(plan: DeploymentPlan): Promise<boolean> {
  logger.header('DevRamps Bootstrap Summary');

  console.log(`Organization: ${plan.orgSlug}`);
  logger.newline();

  const pipelineGroups = new Map<string, StackDeployment[]>();
  for (const stack of plan.stacks) {
    const existing = pipelineGroups.get(stack.pipelineSlug) || [];
    existing.push(stack);
    pipelineGroups.set(stack.pipelineSlug, existing);
  }

  console.log('Pipelines to bootstrap:');
  for (const [slug, stacks] of pipelineGroups) {
    const accounts = new Set(stacks.map(s => s.accountId));
    console.log(`  - ${slug} (${accounts.size} target account${accounts.size !== 1 ? 's' : ''})`);
  }
  logger.newline();

  console.log('Stacks to deploy:');
  const tableRows: string[][] = [
    ['Account ID', 'Pipeline', 'Stack Name', 'Action'],
  ];

  for (const stack of plan.stacks) {
    tableRows.push([
      stack.accountId,
      stack.pipelineSlug,
      stack.stackName,
      stack.action,
    ]);
  }

  logger.table(tableRows);
  logger.newline();

  console.log('Each stack creates:');
  console.log('  - OIDC Identity Provider for devramps.com (if not exists)');
  console.log('  - IAM Role: DevRamps-CICD-DeploymentRole');
  console.log(`    - Trust: org:${plan.orgSlug}/pipeline:<pipeline-slug>`);
  console.log('    - Policies for each deployment step');
  logger.newline();

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Do you want to proceed?',
      default: false,
    },
  ]);

  return proceed;
}

export async function confirmDryRun(plan: DeploymentPlan): Promise<void> {
  logger.header('DevRamps Bootstrap - Dry Run');

  console.log(`Organization: ${plan.orgSlug}`);
  logger.newline();

  console.log('The following stacks would be deployed:');
  logger.newline();

  const tableRows: string[][] = [
    ['Account ID', 'Pipeline', 'Stack Name', 'Action'],
  ];

  for (const stack of plan.stacks) {
    tableRows.push([
      stack.accountId,
      stack.pipelineSlug,
      stack.stackName,
      stack.action,
    ]);
  }

  logger.table(tableRows);
  logger.newline();

  for (const stack of plan.stacks) {
    console.log(`Stack: ${stack.stackName}`);
    console.log(`  Account: ${stack.accountId}`);
    console.log(`  Pipeline: ${stack.pipelineSlug}`);
    console.log(`  Steps with policies:`);
    for (const step of stack.steps) {
      console.log(`    - ${step}`);
    }
    if (stack.additionalPoliciesCount > 0) {
      console.log(`  Additional policies: ${stack.additionalPoliciesCount}`);
    }
    logger.newline();
  }

  logger.info('Dry run complete. No changes were made.');
}
