/**
 * Input validation utilities for AWS resources
 */

/**
 * AWS Account ID format: exactly 12 digits
 */
const AWS_ACCOUNT_ID_REGEX = /^\d{12}$/;

/**
 * AWS Region format: e.g., us-east-1, eu-west-2, ap-northeast-1
 */
const AWS_REGION_REGEX = /^[a-z]{2}-[a-z]+-\d$/;

/**
 * List of valid AWS regions as of 2025
 * This is used as an additional validation alongside the regex pattern
 */
const VALID_AWS_REGIONS = new Set([
  // US regions
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  // EU regions
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  // Asia Pacific regions
  'ap-east-1',
  'ap-south-1',
  'ap-south-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  // South America
  'sa-east-1',
  // Middle East
  'me-south-1',
  'me-central-1',
  // Africa
  'af-south-1',
  // Canada
  'ca-central-1',
  'ca-west-1',
  // China (special)
  'cn-north-1',
  'cn-northwest-1',
  // GovCloud
  'us-gov-east-1',
  'us-gov-west-1',
  // Israel
  'il-central-1',
]);

/**
 * Validate an AWS account ID format
 * @param accountId - The account ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidAwsAccountId(accountId: string): boolean {
  return AWS_ACCOUNT_ID_REGEX.test(accountId);
}

/**
 * Validate an AWS region
 * @param region - The region to validate
 * @returns true if valid, false otherwise
 */
export function isValidAwsRegion(region: string): boolean {
  // Check both the format and if it's in our known list
  return AWS_REGION_REGEX.test(region) || VALID_AWS_REGIONS.has(region);
}

/**
 * Validate AWS account ID and throw if invalid
 * @param accountId - The account ID to validate
 * @param fieldName - Name of the field for error message
 * @throws Error if the account ID is invalid
 */
export function validateAwsAccountId(accountId: string, fieldName = 'AWS account ID'): void {
  if (!isValidAwsAccountId(accountId)) {
    throw new Error(
      `Invalid ${fieldName}: "${accountId}". AWS account IDs must be exactly 12 digits.`
    );
  }
}

/**
 * Validate AWS region and throw if invalid
 * @param region - The region to validate
 * @param fieldName - Name of the field for error message
 * @throws Error if the region is invalid
 */
export function validateAwsRegion(region: string, fieldName = 'AWS region'): void {
  if (!isValidAwsRegion(region)) {
    throw new Error(
      `Invalid ${fieldName}: "${region}". Expected a valid AWS region (e.g., us-east-1, eu-west-2).`
    );
  }
}
