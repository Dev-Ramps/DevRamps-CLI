/**
 * Bucket Policy Merge Strategy
 *
 * Merges S3 bucket policies to allow multiple AWS accounts access.
 * Used primarily for the Terraform state bucket in the org stack.
 *
 * When a new pipeline is bootstrapped, we need to:
 * 1. Read the existing bucket policy (if any)
 * 2. Extract the currently-allowed account IDs
 * 3. Merge with new account IDs from all pipelines
 * 4. Generate an updated policy
 */

import { S3Client, GetBucketPolicyCommand } from '@aws-sdk/client-s3';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { CloudFormationStackResources, MergeContext, ValidationResult } from './strategy.js';
import { BaseMergeStrategy } from './strategy.js';
import * as logger from '../utils/logger.js';
import { isValidAwsAccountId } from '../utils/validation.js';

/**
 * Data structure for bucket policy merge
 */
export interface BucketPolicyData {
  /** AWS account IDs allowed to access the bucket */
  allowedAccountIds: string[];
}

/**
 * Bucket policy merge strategy implementation
 */
export class BucketPolicyMergeStrategy extends BaseMergeStrategy<
  BucketPolicyData,
  BucketPolicyData,
  BucketPolicyData
> {
  readonly strategyId = 'terraform-state-bucket-policy';
  readonly displayName = 'Terraform State Bucket Policy';

  private bucketName: string | null = null;
  private credentials: AwsCredentialIdentity | undefined;
  private region: string = 'us-east-1';

  /**
   * Configure the strategy with bucket details
   */
  configure(bucketName: string, region: string, credentials?: AwsCredentialIdentity): void {
    this.bucketName = bucketName;
    this.region = region;
    this.credentials = credentials;
  }

  /**
   * Extract existing account IDs from the current bucket policy
   */
  async extractExisting(
    stackResources: CloudFormationStackResources
  ): Promise<BucketPolicyData | null> {
    if (!this.bucketName) {
      logger.verbose('No bucket name configured, cannot extract existing policy');
      return null;
    }

    try {
      const client = new S3Client({
        region: this.region,
        credentials: this.credentials,
      });

      const response = await client.send(
        new GetBucketPolicyCommand({ Bucket: this.bucketName })
      );

      if (!response.Policy) {
        logger.verbose('Bucket has no policy');
        return null;
      }

      const policy = JSON.parse(response.Policy);
      const accountIds = this.extractAccountIdsFromPolicy(policy);

      logger.verbose(`Found ${accountIds.length} existing account(s) in bucket policy`);

      return { allowedAccountIds: accountIds };
    } catch (error: unknown) {
      // NoSuchBucketPolicy is expected if bucket exists but has no policy
      if (error instanceof Error && error.name === 'NoSuchBucketPolicy') {
        logger.verbose('Bucket has no policy (NoSuchBucketPolicy)');
        return null;
      }

      // NoSuchBucket means the bucket doesn't exist yet (new deployment)
      if (error instanceof Error && error.name === 'NoSuchBucket') {
        logger.verbose('Bucket does not exist yet');
        return null;
      }

      // Log other errors but don't fail - we'll just use new data
      logger.verbose(`Could not read bucket policy: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Collect all target account IDs from all pipelines
   */
  async collectNew(context: MergeContext): Promise<BucketPolicyData> {
    const accountIds = new Set<string>();

    // Validate and add the CI/CD account
    if (!isValidAwsAccountId(context.cicdAccountId)) {
      throw new Error(
        `Invalid CI/CD account ID: "${context.cicdAccountId}". AWS account IDs must be exactly 12 digits.`
      );
    }
    accountIds.add(context.cicdAccountId);

    // Collect from all pipelines, validating each account ID
    for (const pipeline of context.pipelines) {
      for (const accountId of pipeline.targetAccountIds) {
        if (!isValidAwsAccountId(accountId)) {
          throw new Error(
            `Invalid target account ID in pipeline "${pipeline.slug}": "${accountId}". AWS account IDs must be exactly 12 digits.`
          );
        }
        accountIds.add(accountId);
      }
    }

    logger.verbose(`Collected ${accountIds.size} account(s) from pipelines`);

    return { allowedAccountIds: Array.from(accountIds) };
  }

  /**
   * Merge existing and new account IDs, deduplicating
   */
  merge(
    existing: BucketPolicyData | null,
    newData: BucketPolicyData
  ): BucketPolicyData {
    const mergedAccountIds = new Set<string>();

    // Add existing account IDs
    if (existing) {
      for (const accountId of existing.allowedAccountIds) {
        mergedAccountIds.add(accountId);
      }
    }

    // Add new account IDs
    for (const accountId of newData.allowedAccountIds) {
      mergedAccountIds.add(accountId);
    }

    // Sort for consistent output
    const sorted = Array.from(mergedAccountIds).sort();

    logger.verbose(`Merged to ${sorted.length} unique account(s)`);

    return { allowedAccountIds: sorted };
  }

  /**
   * Validate the merged result
   */
  validate(result: BucketPolicyData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate account IDs format
    for (const accountId of result.allowedAccountIds) {
      if (!/^\d{12}$/.test(accountId)) {
        errors.push(`Invalid AWS account ID format: ${accountId}`);
      }
    }

    // Warn if many accounts (S3 bucket policies have size limits)
    if (result.allowedAccountIds.length > 50) {
      warnings.push(
        `Large number of accounts (${result.allowedAccountIds.length}) in bucket policy. ` +
        `Consider using AWS Organizations conditions instead.`
      );
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Extract account IDs from a bucket policy document
   */
  private extractAccountIdsFromPolicy(policy: unknown): string[] {
    const accountIds: string[] = [];

    if (!policy || typeof policy !== 'object') {
      return accountIds;
    }

    const policyDoc = policy as { Statement?: unknown[] };

    if (!Array.isArray(policyDoc.Statement)) {
      return accountIds;
    }

    for (const statement of policyDoc.Statement) {
      if (!statement || typeof statement !== 'object') continue;

      const stmt = statement as { Principal?: { AWS?: string | string[] } };
      const principal = stmt.Principal?.AWS;

      if (!principal) continue;

      const principals = Array.isArray(principal) ? principal : [principal];

      for (const p of principals) {
        let extractedId: string | null = null;

        // Match patterns like:
        // - arn:aws:iam::123456789012:root
        // - arn:aws:iam::123456789012:role/RoleName
        // - 123456789012 (just account ID)
        const arnMatch = p.match(/arn:aws:iam::(\d{12}):/);
        if (arnMatch) {
          extractedId = arnMatch[1];
        } else if (/^\d{12}$/.test(p)) {
          // Direct account ID
          extractedId = p;
        }

        // Validate extracted account ID before adding
        if (extractedId) {
          if (isValidAwsAccountId(extractedId)) {
            accountIds.push(extractedId);
          } else {
            logger.verbose(`Skipping invalid account ID from existing policy: "${extractedId}"`);
          }
        }
      }
    }

    // Deduplicate
    return [...new Set(accountIds)];
  }
}

/**
 * Create a bucket policy document for the Terraform state bucket
 */
export function createTerraformStateBucketPolicy(
  bucketName: string,
  cicdAccountId: string,
  allowedAccountIds: string[]
): object {
  // Build statements allowing each target account
  const accountStatements = allowedAccountIds
    .filter(id => id !== cicdAccountId) // CI/CD account gets full access separately
    .map(accountId => ({
      Sid: `AllowAccount${accountId}`,
      Effect: 'Allow',
      Principal: {
        AWS: `arn:aws:iam::${accountId}:root`,
      },
      Action: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
      ],
      Resource: `arn:aws:s3:::${bucketName}/*`,
    }));

  // Add list bucket permission for all accounts
  const listStatement = {
    Sid: 'AllowListBucket',
    Effect: 'Allow',
    Principal: {
      AWS: allowedAccountIds.map(id => `arn:aws:iam::${id}:root`),
    },
    Action: 's3:ListBucket',
    Resource: `arn:aws:s3:::${bucketName}`,
  };

  // CI/CD account gets full access
  const cicdStatement = {
    Sid: 'AllowCICDAccount',
    Effect: 'Allow',
    Principal: {
      AWS: `arn:aws:iam::${cicdAccountId}:root`,
    },
    Action: 's3:*',
    Resource: [
      `arn:aws:s3:::${bucketName}`,
      `arn:aws:s3:::${bucketName}/*`,
    ],
  };

  return {
    Version: '2012-10-17',
    Statement: [cicdStatement, listStatement, ...accountStatements],
  };
}
