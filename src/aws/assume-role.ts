/**
 * Role assumption logic for cross-account access
 */

import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { RoleAssumptionError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { DEFAULT_TARGET_ROLE, FALLBACK_TARGET_ROLE } from '../types/config.js';
import type { AssumedRoleCredentials } from '../types/aws.js';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

export interface AssumeRoleOptions {
  targetAccountId: string;
  currentAccountId: string;
  targetRoleName?: string;
}

export async function assumeRoleForAccount(
  options: AssumeRoleOptions
): Promise<AssumedRoleCredentials | null> {
  const { targetAccountId, currentAccountId, targetRoleName } = options;

  // If target account is the same as current account, no need to assume role
  if (targetAccountId === currentAccountId) {
    logger.verbose(`Target account ${targetAccountId} is the current account, using current credentials`);
    return null;
  }

  const rolesToTry = targetRoleName
    ? [targetRoleName]
    : [DEFAULT_TARGET_ROLE, FALLBACK_TARGET_ROLE];

  let lastError: Error | undefined;

  for (const roleName of rolesToTry) {
    const roleArn = `arn:aws:iam::${targetAccountId}:role/${roleName}`;

    try {
      logger.verbose(`Attempting to assume role: ${roleArn}`);
      const credentials = await assumeRole(roleArn);

      logger.verbose(`Successfully assumed role: ${roleName}`);

      return {
        credentials,
        accountId: targetAccountId,
        roleArn,
      };
    } catch (error) {
      logger.verbose(`Failed to assume role ${roleName}: ${error instanceof Error ? error.message : String(error)}`);
      lastError = error instanceof Error ? error : new Error(String(error));

      // If a specific role was requested, don't try fallbacks
      if (targetRoleName) {
        break;
      }
    }
  }

  // All role attempts failed
  const attemptedRole = targetRoleName || `${DEFAULT_TARGET_ROLE} or ${FALLBACK_TARGET_ROLE}`;
  throw new RoleAssumptionError(targetAccountId, attemptedRole, currentAccountId);
}

// Default region for STS (global service, any region works)
const DEFAULT_REGION = 'us-east-1';

async function assumeRole(roleArn: string): Promise<AwsCredentialIdentity> {
  const client = new STSClient({ region: DEFAULT_REGION });

  const response = await client.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'DevRampsBootstrap',
      DurationSeconds: 3600, // 1 hour
    })
  );

  if (!response.Credentials) {
    throw new Error('AssumeRole returned no credentials');
  }

  const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = response.Credentials;

  if (!AccessKeyId || !SecretAccessKey) {
    throw new Error('AssumeRole returned incomplete credentials');
  }

  return {
    accessKeyId: AccessKeyId,
    secretAccessKey: SecretAccessKey,
    sessionToken: SessionToken,
    expiration: Expiration,
  };
}
