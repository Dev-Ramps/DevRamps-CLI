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

// DeploymentPlan and StackDeployment types have moved to ./stacks.ts
// Re-export for backward compatibility during migration
export type { DeploymentPlan, StackDeployment } from './stacks.js';

export const DEFAULT_TARGET_ROLE = 'OrganizationAccountAccessRole';
export const FALLBACK_TARGET_ROLE = 'AWSControlTowerExecution';
export const OIDC_PROVIDER_URL = 'devramps.com';
export const DEPLOYMENT_ROLE_NAME = 'DevRamps-CICD-DeploymentRole';
