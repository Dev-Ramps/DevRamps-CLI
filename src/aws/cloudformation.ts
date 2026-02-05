/**
 * CloudFormation stack deployment operations
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackResourcesCommand,
  CreateStackCommand,
  UpdateStackCommand,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DeleteChangeSetCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
  waitUntilChangeSetCreateComplete,
  ChangeSetType,
  type DescribeStacksOutput,
  type Change,
} from '@aws-sdk/client-cloudformation';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { CloudFormationError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import type { StackStatus, CloudFormationTemplate } from '../types/aws.js';
import type { CloudFormationStackResources } from '../merge/strategy.js';

export interface DeployStackOptions {
  stackName: string;
  template: CloudFormationTemplate;
  accountId: string;
  region?: string;
  credentials?: AwsCredentialIdentity;
}

export async function getStackStatus(
  stackName: string,
  credentials?: AwsCredentialIdentity,
  region?: string
): Promise<StackStatus> {
  const client = new CloudFormationClient({
    credentials,
    region,
  });

  try {
    const response: DescribeStacksOutput = await client.send(
      new DescribeStacksCommand({ StackName: stackName })
    );

    const stack = response.Stacks?.[0];

    if (!stack) {
      return { exists: false };
    }

    return {
      exists: true,
      status: stack.StackStatus,
      stackId: stack.StackId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('does not exist')) {
      return { exists: false };
    }

    throw error;
  }
}

/**
 * Preview what changes will be made to a stack by creating and describing a change set.
 * Note: Only previews updates to existing stacks. For new stacks, logs that they will be created.
 */
export async function previewStackChanges(options: DeployStackOptions): Promise<void> {
  const { stackName, template, region, credentials } = options;

  const client = new CloudFormationClient({
    credentials,
    region,
  });

  const templateBody = JSON.stringify(template);
  const stackStatus = await getStackStatus(stackName, credentials, region);
  const changeSetName = `devramps-preview-${Date.now()}`;

  // Skip preview for new stacks - creating a change set with ChangeSetType.CREATE
  // puts the stack into REVIEW_IN_PROGRESS status, which blocks subsequent deployments
  if (!stackStatus.exists) {
    logger.info(`  Stack ${stackName} will be created (new stack)`);
    return;
  }

  try {
    // Create a change set to preview changes (only for existing stacks)
    await client.send(
      new CreateChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
        TemplateBody: templateBody,
        Capabilities: ['CAPABILITY_NAMED_IAM'],
        ChangeSetType: ChangeSetType.UPDATE,
      })
    );

    // Wait for change set to be created
    await waitUntilChangeSetCreateComplete(
      { client, maxWaitTime: 120 },
      { StackName: stackName, ChangeSetName: changeSetName }
    );

    // Describe the change set to get the changes
    const changeSetResponse = await client.send(
      new DescribeChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
      })
    );

    // Log the changes
    logStackChanges(stackName, changeSetResponse.Changes || [], stackStatus.exists);

    // Delete the change set (we just wanted to preview)
    await client.send(
      new DeleteChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
      })
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // "No updates are to be performed" means no changes
    if (errorMessage.includes('No updates are to be performed') ||
        errorMessage.includes("didn't contain changes")) {
      logger.verbose(`  Stack ${stackName}: No changes`);
      return;
    }

    // Try to clean up the change set if it exists
    try {
      await client.send(
        new DeleteChangeSetCommand({
          StackName: stackName,
          ChangeSetName: changeSetName,
        })
      );
    } catch {
      // Ignore cleanup errors
    }

    // For preview, we don't want to throw - just log the issue
    logger.verbose(`  Could not preview changes for ${stackName}: ${errorMessage}`);
  }
}

/**
 * Log the changes from a change set in a readable format
 */
function logStackChanges(stackName: string, changes: Change[], isUpdate: boolean): void {
  if (changes.length === 0) {
    logger.verbose(`  Stack ${stackName}: No changes`);
    return;
  }

  const action = isUpdate ? 'update' : 'create';
  logger.info(`  Stack ${stackName} will ${action} ${changes.length} resource(s):`);

  for (const change of changes) {
    const resourceChange = change.ResourceChange;
    if (!resourceChange) continue;

    const actionSymbol = getActionSymbol(resourceChange.Action);
    const resourceType = resourceChange.ResourceType || 'Unknown';
    const logicalId = resourceChange.LogicalResourceId || 'Unknown';
    const replacement = resourceChange.Replacement === 'True' ? ' (REPLACEMENT)' : '';

    logger.info(`    ${actionSymbol} ${resourceType} ${logicalId}${replacement}`);
  }
}

/**
 * Get a symbol for the change action
 */
function getActionSymbol(action: string | undefined): string {
  switch (action) {
    case 'Add':
      return '+';
    case 'Modify':
      return '~';
    case 'Remove':
      return '-';
    case 'Import':
      return '>';
    case 'Dynamic':
      return '?';
    default:
      return ' ';
  }
}

export async function deployStack(options: DeployStackOptions): Promise<void> {
  const { stackName, template, accountId, region, credentials } = options;

  const client = new CloudFormationClient({
    credentials,
    region,
  });

  const templateBody = JSON.stringify(template);

  try {
    const stackStatus = await getStackStatus(stackName, credentials, region);

    if (stackStatus.exists) {
      logger.verbose(`Stack ${stackName} exists, updating...`);
      await updateStack(client, stackName, templateBody, accountId);
    } else {
      logger.verbose(`Stack ${stackName} does not exist, creating...`);
      await createStack(client, stackName, templateBody, accountId);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // "No updates are to be performed" is not an error
    if (errorMessage.includes('No updates are to be performed')) {
      logger.verbose(`Stack ${stackName} is already up to date`);
      return;
    }

    throw new CloudFormationError(stackName, accountId, errorMessage);
  }
}

async function createStack(
  client: CloudFormationClient,
  stackName: string,
  templateBody: string,
  accountId: string
): Promise<void> {
  await client.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ['CAPABILITY_NAMED_IAM'],
      Tags: [
        { Key: 'CreatedBy', Value: 'DevRamps' },
        { Key: 'ManagedBy', Value: 'DevRamps-CLI' },
      ],
    })
  );

  logger.verbose(`Waiting for stack ${stackName} to be created...`);

  await waitUntilStackCreateComplete(
    { client, maxWaitTime: 600 },
    { StackName: stackName }
  );

  logger.success(`Stack ${stackName} created successfully in account ${accountId}`);
}

async function updateStack(
  client: CloudFormationClient,
  stackName: string,
  templateBody: string,
  accountId: string
): Promise<void> {
  await client.send(
    new UpdateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ['CAPABILITY_NAMED_IAM'],
    })
  );

  logger.verbose(`Waiting for stack ${stackName} to be updated...`);

  await waitUntilStackUpdateComplete(
    { client, maxWaitTime: 600 },
    { StackName: stackName }
  );

  logger.success(`Stack ${stackName} updated successfully in account ${accountId}`);
}

/**
 * Read existing stack resources and outputs for merge operations
 */
export async function readExistingStack(
  stackName: string,
  accountId: string,
  region: string,
  credentials?: AwsCredentialIdentity
): Promise<CloudFormationStackResources | null> {
  const client = new CloudFormationClient({
    credentials,
    region,
  });

  try {
    // Get stack details including outputs
    const stacksResponse = await client.send(
      new DescribeStacksCommand({ StackName: stackName })
    );

    const stack = stacksResponse.Stacks?.[0];
    if (!stack) {
      return null;
    }

    // Get stack resources
    const resourcesResponse = await client.send(
      new DescribeStackResourcesCommand({ StackName: stackName })
    );

    // Convert outputs to a simple key-value map
    const outputs: Record<string, string> = {};
    if (stack.Outputs) {
      for (const output of stack.Outputs) {
        if (output.OutputKey && output.OutputValue) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      }
    }

    // Convert resources to a simple map
    const resources: Record<string, unknown> = {};
    if (resourcesResponse.StackResources) {
      for (const resource of resourcesResponse.StackResources) {
        if (resource.LogicalResourceId) {
          resources[resource.LogicalResourceId] = {
            type: resource.ResourceType,
            physicalId: resource.PhysicalResourceId,
            status: resource.ResourceStatus,
          };
        }
      }
    }

    return {
      stackName,
      accountId,
      region,
      resources,
      outputs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('does not exist')) {
      return null;
    }

    logger.verbose(`Could not read stack ${stackName}: ${errorMessage}`);
    return null;
  }
}
