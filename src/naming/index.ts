/**
 * Resource naming utilities with consistent truncation for AWS limits
 *
 * AWS Resource Limits:
 * - S3 bucket names: 3-63 characters, lowercase, alphanumeric and hyphens
 * - ECR repo names: 2-256 characters, lowercase, alphanumeric, hyphens, underscores, forward slashes
 * - IAM role names: 1-64 characters
 * - CloudFormation stack names: 1-128 characters, alphanumeric and hyphens
 */

const S3_BUCKET_MAX_LENGTH = 63;
const ECR_REPO_MAX_LENGTH = 256;
const IAM_ROLE_MAX_LENGTH = 64;
const CF_STACK_MAX_LENGTH = 128;

/**
 * Normalize a name for use in resource identifiers
 * - Lowercase
 * - Replace non-alphanumeric with hyphens
 * - Remove consecutive hyphens
 * - Remove leading/trailing hyphens
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a short hash from a string for uniqueness
 * Uses a simple but deterministic hash function
 */
function generateShortHash(input: string, length: number = 6): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).substring(0, length).padStart(length, '0');
}

/**
 * Truncate a name to a maximum length, preserving meaningful parts
 * If truncation is needed, adds a hash suffix to ensure uniqueness
 */
export function truncateName(name: string, maxLength: number, hashLength: number = 6): string {
  if (name.length <= maxLength) {
    return name;
  }

  // Calculate available space for name and separator
  const availableLength = maxLength - hashLength - 1; // -1 for separator
  const hash = generateShortHash(name, hashLength);

  return `${name.substring(0, availableLength)}-${hash}`;
}

/**
 * Sanitize a name for use as a CloudFormation resource ID
 * Only alphanumeric characters allowed
 */
export function sanitizeResourceId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 64);
}

// ============================================================================
// S3 Bucket Names
// ============================================================================

/**
 * Generate Terraform state bucket name for org stack
 * Format: devramps-<org_slug>-terraform-state
 */
export function generateTerraformStateBucketName(orgSlug: string): string {
  const normalized = normalizeName(`devramps-${orgSlug}-terraform-state`);
  return truncateName(normalized, S3_BUCKET_MAX_LENGTH);
}

/**
 * Generate root S3 bucket name for bundle artifacts in pipeline stack
 * Format: <cicd_account_id>-<pipeline_slug>-<artifact_id>
 */
export function generatePipelineBucketName(
  cicdAccountId: string,
  pipelineSlug: string,
  artifactId: string
): string {
  const normalized = normalizeName(`${cicdAccountId}-${pipelineSlug}-${artifactId}`);
  return truncateName(normalized, S3_BUCKET_MAX_LENGTH);
}

/**
 * Generate S3 bucket name for stage artifacts
 * Format: <account_id>-<pipeline_slug>-<stage_name>-<artifact_id>
 */
export function generateStageBucketName(
  accountId: string,
  pipelineSlug: string,
  stageName: string,
  artifactId: string
): string {
  const normalized = normalizeName(`${accountId}-${pipelineSlug}-${stageName}-${artifactId}`);
  return truncateName(normalized, S3_BUCKET_MAX_LENGTH);
}

// ============================================================================
// ECR Repository Names
// ============================================================================

/**
 * Generate root ECR repository name for docker artifacts in pipeline stack
 * Format: <pipeline_slug>-<artifact_id>
 */
export function generatePipelineEcrRepoName(
  pipelineSlug: string,
  artifactId: string
): string {
  const normalized = normalizeName(`${pipelineSlug}-${artifactId}`);
  return truncateName(normalized, ECR_REPO_MAX_LENGTH);
}

/**
 * Generate ECR repository name for stage artifacts
 * Format: <pipeline_slug>-<stage_name>-<artifact_id>
 */
export function generateStageEcrRepoName(
  pipelineSlug: string,
  stageName: string,
  artifactId: string
): string {
  const normalized = normalizeName(`${pipelineSlug}-${stageName}-${artifactId}`);
  return truncateName(normalized, ECR_REPO_MAX_LENGTH);
}

// ============================================================================
// IAM Role Names
// ============================================================================

/**
 * Generate org-level CICD deployment role name
 * Fixed name: DevRamps-CICD-DeploymentRole
 */
export function getOrgRoleName(): string {
  return 'DevRamps-CICD-DeploymentRole';
}

/**
 * Generate stage deployment role name
 * Format: DevRamps-<pipeline_slug>-<stage_name>-DeploymentRole
 */
export function generateStageRoleName(pipelineSlug: string, stageName: string): string {
  const baseName = `DevRamps-${pipelineSlug}-${stageName}-DeploymentRole`;
  return truncateName(baseName, IAM_ROLE_MAX_LENGTH);
}

// ============================================================================
// CloudFormation Stack Names
// ============================================================================

/**
 * Generate org stack name
 * Format: DevRamps-<org_slug>-Org
 */
export function getOrgStackName(orgSlug: string): string {
  return truncateName(`DevRamps-${orgSlug}-Org`, CF_STACK_MAX_LENGTH);
}

/**
 * Generate pipeline stack name
 * Format: DevRamps-<pipeline_slug>-Pipeline
 */
export function getPipelineStackName(pipelineSlug: string): string {
  return truncateName(`DevRamps-${pipelineSlug}-Pipeline`, CF_STACK_MAX_LENGTH);
}

/**
 * Generate stage stack name
 * Format: DevRamps-<pipeline_slug>-<stage_name>-Stage
 */
export function getStageStackName(pipelineSlug: string, stageName: string): string {
  return truncateName(`DevRamps-${pipelineSlug}-${stageName}-Stage`, CF_STACK_MAX_LENGTH);
}

/**
 * Generate account bootstrap stack name
 * Format: DevRamps-Account-Bootstrap
 * This stack is deployed once per account to create the OIDC provider
 */
export function getAccountStackName(): string {
  return 'DevRamps-Account-Bootstrap';
}

// ============================================================================
// Import Stack Names and Roles
// ============================================================================

/**
 * Generate import stack name for a pipeline
 * Format: DevRamps-<pipeline_slug>-Import
 */
export function getImportStackName(pipelineSlug: string): string {
  return truncateName(`DevRamps-${pipelineSlug}-Import`, CF_STACK_MAX_LENGTH);
}

/**
 * Generate import role name for a pipeline
 * Format: DevRamps-<pipeline_slug>-ImportRole
 */
export function generateImportRoleName(pipelineSlug: string): string {
  return truncateName(`DevRamps-${pipelineSlug}-ImportRole`, IAM_ROLE_MAX_LENGTH);
}

// ============================================================================
// KMS Key Names
// ============================================================================

/**
 * Generate KMS key alias for org
 * Format: alias/devramps-<org_slug>
 */
export function getKmsKeyAlias(orgSlug: string): string {
  return `alias/devramps-${normalizeName(orgSlug)}`;
}
