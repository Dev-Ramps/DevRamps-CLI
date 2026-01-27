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
}

export interface DeploymentPlan {
  orgSlug: string;
  stacks: StackDeployment[];
}

export interface StackDeployment {
  accountId: string;
  pipelineSlug: string;
  stackName: string;
  action: 'CREATE' | 'UPDATE';
  steps: string[];
  additionalPoliciesCount: number;
}

export const DEFAULT_TARGET_ROLE = 'OrganizationAccountAccessRole';
export const FALLBACK_TARGET_ROLE = 'AWSControlTowerExecution';
export const OIDC_PROVIDER_URL = 'devramps.com';
export const DEPLOYMENT_ROLE_NAME = 'DevRamps-CICD-DeploymentRole';
