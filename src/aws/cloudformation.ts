/**
 * CloudFormation stack deployment operations
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackResourcesCommand,
  DescribeStackEventsCommand,
  CreateStackCommand,
  UpdateStackCommand,
  DeleteStackCommand,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DeleteChangeSetCommand,
  waitUntilChangeSetCreateComplete,
  waitUntilStackDeleteComplete,
  ChangeSetType,
  type DescribeStacksOutput,
  type Change,
} from '@aws-sdk/client-cloudformation';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { CloudFormationError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { getMultiStackProgress } from '../utils/logger.js';
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
    logger.info(`  Stack ${stackName} will be created (new stack) in account ${options.accountId} (${region || 'default region'})`);
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
    logStackChanges(stackName, changeSetResponse.Changes || [], stackStatus.exists, options.accountId, region);

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
function logStackChanges(stackName: string, changes: Change[], isUpdate: boolean, accountId: string, region?: string): void {
  if (changes.length === 0) {
    logger.verbose(`  Stack ${stackName}: No changes`);
    return;
  }

  const action = isUpdate ? 'update' : 'create';
  logger.info(`  Stack ${stackName} will ${action} ${changes.length} resource(s) in account ${accountId} (${region || 'default region'}):`);

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

/**
 * Terminal status states for CloudFormation stacks
 */
const TERMINAL_STATES = new Set([
  'CREATE_COMPLETE',
  'CREATE_FAILED',
  'DELETE_COMPLETE',
  'DELETE_FAILED',
  'ROLLBACK_COMPLETE',
  'ROLLBACK_FAILED',
  'UPDATE_COMPLETE',
  'UPDATE_FAILED',
  'UPDATE_ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
]);

const SUCCESS_STATES = new Set([
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE',
]);

/**
 * Check if a resource status indicates completion (not rollback)
 */
function isResourceComplete(status: string | undefined): boolean {
  if (!status) return false;
  return status.includes('_COMPLETE') && !status.includes('ROLLBACK');
}

/**
 * Wait for a stack operation to complete while updating multi-stack progress
 */
async function waitForStackWithProgress(
  client: CloudFormationClient,
  stackName: string,
  accountId: string,
  region: string,
  operationStartTime: Date,
  _totalResources: number,
  maxWaitTime: number = 600
): Promise<void> {
  const seenEventIds = new Set<string>();
  const completedResources = new Set<string>();
  const startTime = Date.now();
  const pollInterval = 2000; // Poll every 2 seconds for more responsive updates

  const progress = getMultiStackProgress();
  let latestResourceId = '';
  let latestFailureReason = ''; // Capture actual failure reasons from events

  logger.verbose(`[${stackName}] Starting to wait for stack operation...`);

  try {
    while (true) {
      // Check if we've exceeded max wait time
      if (Date.now() - startTime > maxWaitTime * 1000) {
        throw new Error(`Stack operation timed out after ${maxWaitTime} seconds`);
      }

      // Get current stack status
      const stackResponse = await client.send(
        new DescribeStacksCommand({ StackName: stackName })
      );
      const stack = stackResponse.Stacks?.[0];
      if (!stack) {
        throw new Error(`Stack ${stackName} not found`);
      }

      const currentStatus = stack.StackStatus || '';
      logger.verbose(`[${stackName}] Current status: ${currentStatus}`);

      // Get stack events
      const eventsResponse = await client.send(
        new DescribeStackEventsCommand({ StackName: stackName })
      );

      // Filter and display new events (in chronological order)
      const newEvents = (eventsResponse.StackEvents || [])
        .filter(event => {
          // Only show events from after the operation started
          if (!event.Timestamp || event.Timestamp < operationStartTime) return false;
          // Only show events we haven't seen
          if (!event.EventId || seenEventIds.has(event.EventId)) return false;
          return true;
        })
        .reverse(); // Show oldest first

      for (const event of newEvents) {
        if (event.EventId) {
          seenEventIds.add(event.EventId);
        }

        const logicalId = event.LogicalResourceId;
        const status = event.ResourceStatus || '';

        // Skip the stack itself
        if (logicalId && logicalId !== stackName) {
          // Update latest resource for display
          latestResourceId = logicalId;

          logger.verbose(`[${stackName}] Resource ${logicalId}: ${status}`);

          if (isResourceComplete(status)) {
            completedResources.add(logicalId);
          }

          // Capture failure reasons
          if (status.includes('FAILED') && event.ResourceStatusReason) {
            latestFailureReason = `${logicalId}: ${event.ResourceStatusReason}`;
            logger.verbose(`[${stackName}] Failure reason: ${latestFailureReason}`);
          }
        }
      }

      // Determine stack status for display
      let displayStatus: 'pending' | 'in_progress' | 'complete' | 'failed' | 'rollback' = 'in_progress';
      if (currentStatus.includes('ROLLBACK')) {
        displayStatus = 'rollback';
      } else if (currentStatus.includes('FAILED')) {
        displayStatus = 'failed';
      }

      // Update progress display with CFN status
      progress.updateStack(stackName, accountId, region, completedResources.size, displayStatus, currentStatus, latestResourceId);

      // Check if we've reached a terminal state
      if (TERMINAL_STATES.has(currentStatus)) {
        const success = SUCCESS_STATES.has(currentStatus);
        // Use actual failure reason if available, otherwise use the CFN status
        const failureReason = success ? undefined : (latestFailureReason || currentStatus);
        progress.completeStack(stackName, accountId, region, success, failureReason);
        logger.verbose(`[${stackName}] Reached terminal state: ${currentStatus} (success: ${success})`);
        if (success) {
          return; // Success!
        }
        // Any terminal state that isn't SUCCESS is a failure
        throw new Error(`Stack operation failed with status: ${currentStatus}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  } catch (error) {
    progress.completeStack(stackName, accountId, region, false);
    throw error;
  }
}

export async function deployStack(options: DeployStackOptions): Promise<void> {
  const { stackName, template, accountId, region = 'us-east-1', credentials } = options;

  const client = new CloudFormationClient({
    credentials,
    region,
  });

  const templateBody = JSON.stringify(template);
  const resourceCount = Object.keys(template.Resources || {}).length;

  // Mark stack as started in progress display
  const progress = getMultiStackProgress();
  progress.startStack(stackName, accountId, region);

  try {
    const stackStatus = await getStackStatus(stackName, credentials, region);

    // Handle ROLLBACK_COMPLETE - must delete before recreating
    if (stackStatus.exists && stackStatus.status === 'ROLLBACK_COMPLETE') {
      logger.verbose(`Stack ${stackName} is in ROLLBACK_COMPLETE state, deleting before recreating...`);
      await deleteStack(client, stackName);
      logger.verbose(`Stack ${stackName} deleted, now creating...`);
      await createStack(client, stackName, accountId, region, templateBody, resourceCount);
    } else if (stackStatus.exists) {
      logger.verbose(`Stack ${stackName} exists, updating...`);
      await updateStack(client, stackName, accountId, region, templateBody, resourceCount);
    } else {
      logger.verbose(`Stack ${stackName} does not exist, creating...`);
      await createStack(client, stackName, accountId, region, templateBody, resourceCount);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // "No updates are to be performed" is not an error
    if (errorMessage.includes('No updates are to be performed')) {
      logger.verbose(`Stack ${stackName} is already up to date`);
      progress.completeStack(stackName, accountId, region, true);
      return;
    }

    progress.completeStack(stackName, accountId, region, false);
    throw new CloudFormationError(stackName, accountId, errorMessage);
  }
}

/**
 * Delete a stack and wait for completion
 */
async function deleteStack(
  client: CloudFormationClient,
  stackName: string
): Promise<void> {
  await client.send(
    new DeleteStackCommand({
      StackName: stackName,
    })
  );

  // Wait for delete to complete
  await waitUntilStackDeleteComplete(
    { client, maxWaitTime: 300 },
    { StackName: stackName }
  );
}

async function createStack(
  client: CloudFormationClient,
  stackName: string,
  accountId: string,
  region: string,
  templateBody: string,
  resourceCount: number
): Promise<void> {
  const operationStartTime = new Date();

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

  await waitForStackWithProgress(client, stackName, accountId, region, operationStartTime, resourceCount);
}

async function updateStack(
  client: CloudFormationClient,
  stackName: string,
  accountId: string,
  region: string,
  templateBody: string,
  resourceCount: number
): Promise<void> {
  const operationStartTime = new Date();

  await client.send(
    new UpdateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ['CAPABILITY_NAMED_IAM'],
    })
  );

  await waitForStackWithProgress(client, stackName, accountId, region, operationStartTime, resourceCount);
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
