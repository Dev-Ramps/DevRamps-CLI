/**
 * AWS credential detection and validation
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { NoCredentialsError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import type { CurrentIdentity } from '../types/aws.js';

// Default region for STS (global service, any region works)
const DEFAULT_REGION = 'us-east-1';

export async function getCurrentIdentity(): Promise<CurrentIdentity> {
  const client = new STSClient({ region: DEFAULT_REGION });

  try {
    logger.verbose('Checking AWS credentials...');
    const response = await client.send(new GetCallerIdentityCommand({}));

    if (!response.Account || !response.Arn || !response.UserId) {
      throw new NoCredentialsError();
    }

    logger.verbose(`Authenticated as: ${response.Arn}`);
    logger.verbose(`Account ID: ${response.Account}`);

    return {
      accountId: response.Account,
      arn: response.Arn,
      userId: response.UserId,
    };
  } catch (error) {
    if (error instanceof NoCredentialsError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('Could not load credentials') ||
      errorMessage.includes('Missing credentials') ||
      errorMessage.includes('ExpiredToken') ||
      errorMessage.includes('InvalidClientTokenId')
    ) {
      throw new NoCredentialsError();
    }

    throw error;
  }
}

export function createSTSClient(region?: string): STSClient {
  return new STSClient({ region });
}
