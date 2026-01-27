/**
 * Pipeline definition types matching the pipeline.yaml schema
 */

export interface PipelineStep {
  name: string;
  type: string;
  goes_after?: string[];
  params?: Record<string, unknown>;
}

export interface InfrastructureConfig {
  requires_approval?: 'ALWAYS' | 'DESTRUCTIVE_CHANGES_ONLY' | 'NEVER';
  source?: string;
  variables?: Record<string, unknown>;
}

export interface DeploymentTarget {
  account_id: string;
  region: string;
}

export interface Stage {
  name: string;
  deployment_time_window?: string;
  deployment_target: DeploymentTarget;
  infrastructure?: InfrastructureConfig;
}

export interface Artifact {
  name: string;
  type: string;
  architecture?: string;
  host_size?: string;
  params?: Record<string, unknown>;
}

export interface PipelineDefaults {
  deployment_time_window?: string;
  infrastructure?: InfrastructureConfig;
  steps?: PipelineStep[];
}

export interface PipelineConfig {
  cloud_provider: 'AWS';
  infrastructure_provider?: string;
  cicd_account_id?: string;
  requires_approval?: 'ALWAYS' | 'DESTRUCTIVE_CHANGES_ONLY' | 'NEVER';
  stages: Stage[];
  defaults?: PipelineDefaults;
  artifacts?: Artifact[];
}

export interface PipelineDefinition {
  version: string;
  pipeline: PipelineConfig;
}

export interface ParsedPipeline {
  slug: string;
  definition: PipelineDefinition;
  targetAccountIds: string[];
  steps: PipelineStep[];
  additionalPolicies: IamPolicy[];
}

export interface IamPolicy {
  Version?: string;
  Statement: IamPolicyStatement[];
}

export interface IamPolicyStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}
