/**
 * CLI configuration and options types
 */

export interface BootstrapOptions {
  targetAccountRoleName?: string;
  pipelineSlugs?: string;
  dryRun?: boolean;
  verbose?: boolean;
  endpointOverride?: string;
}

export interface AuthData {
  orgSlug: string;
  cicdAccountId: string;
  cicdRegion: string;
}

/**
 * Response from the OAuth /token endpoint
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  organization_id: string;
}

/**
 * Response from GET /api/v1/organizations/:orgId
 */
export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  tier: string;
}

/**
 * Response from GET /api/v1/organizations/:orgId/aws/configuration
 */
export interface AwsConfigurationResponse {
  id: string;
  organizationId: string;
  defaultRegion: string;
  cicdAccountId: string | null;
  cicdAccount: {
    id: string;
    organizationId: string;
    accountId: string;
  } | null;
}

// DeploymentPlan and StackDeployment types have moved to ./stacks.ts
// Re-export for backward compatibility during migration
export type { DeploymentPlan, StackDeployment } from './stacks.js';

export const DEFAULT_TARGET_ROLE = 'OrganizationAccountAccessRole';
export const FALLBACK_TARGET_ROLE = 'AWSControlTowerExecution';
export const OIDC_PROVIDER_URL = 'devramps.com';
export const DEPLOYMENT_ROLE_NAME = 'DevRamps-CICD-DeploymentRole';
