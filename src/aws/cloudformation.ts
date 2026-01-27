/**
 * CloudFormation stack deployment operations
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
  type DescribeStacksOutput,
} from '@aws-sdk/client-cloudformation';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { CloudFormationError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import type { StackStatus, CloudFormationTemplate } from '../types/aws.js';

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
