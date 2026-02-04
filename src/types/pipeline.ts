/**
 * Pipeline definition types matching the pipeline.yaml schema
 *
 * New structure (v1.0.0):
 * - Stages have direct account_id and region (not nested in deployment_target)
 * - Steps are at pipeline.steps level (not pipeline.defaults.steps)
 * - Artifacts are a named map with type-specific properties
 */

export interface PipelineStep {
  name: string;
  /** Optional ID for referencing in templates */
  id?: string;
  type: string;
  goes_after?: string[];
  params?: Record<string, unknown>;
}

export interface InfrastructureConfig {
  requires_approval?: 'ALWAYS' | 'DESTRUCTIVE_CHANGES_ONLY' | 'NEVER';
  source?: string;
  variables?: Record<string, unknown>;
}

/**
 * Stage definition - represents a deployment target (account + region)
 * Note: account_id and region are now direct properties (not nested)
 */
export interface Stage {
  name: string;
  /** Target AWS account ID */
  account_id: string;
  /** Target AWS region */
  region: string;
  /** Deployment time window (e.g., PACIFIC_WORKING_HOURS, NONE) */
  deployment_time_window?: string;
  /** Step names/IDs to skip for this stage */
  skip?: string[];
  /** CloudWatch alarm name for auto-rollback */
  auto_rollback_alarm_name?: string;
  /** Stage-specific variables */
  vars?: Record<string, unknown>;
  /** Infrastructure configuration overrides */
  infrastructure?: InfrastructureConfig;
}

/**
 * Raw artifact definition from pipeline.yaml
 * The key in the artifacts map becomes the artifact name
 */
export interface RawArtifact {
  /** Optional ID for referencing (defaults to normalized name) */
  id?: string;
  type: string;
  architecture?: string;
  host_size?: string;
  /** If true, built/imported separately per stage */
  per_stage?: boolean;
  rebuild_when_changed?: string[];
  dependencies?: string[];
  params?: Record<string, unknown>;
}

/**
 * Stage defaults that apply to all stages unless overridden
 */
export interface StageDefaults {
  deployment_time_window?: string;
  infrastructure?: InfrastructureConfig;
}

/**
 * Pipeline configuration within pipeline.yaml
 */
export interface PipelineConfig {
  cloud_provider: 'AWS';
  infrastructure_provider?: string;
  /** Approval requirement for pipeline updates */
  pipeline_updates_require_approval?: 'ALWAYS' | 'DESTRUCTIVE_CHANGES_ONLY' | 'NEVER';
  /** Default settings for all stages */
  stage_defaults?: StageDefaults;
  /** Deployment stages */
  stages: Stage[];
  /** Pipeline steps (deployment actions) */
  steps: PipelineStep[];
  /** Build artifacts (Docker images, bundles) - keyed by artifact name */
  artifacts?: Record<string, RawArtifact>;
}

/**
 * Root pipeline definition from pipeline.yaml
 */
export interface PipelineDefinition {
  version: string;
  pipeline: PipelineConfig;
}

/**
 * Parsed pipeline with extracted data for deployment
 */
export interface ParsedPipeline {
  /** Pipeline slug (folder name) */
  slug: string;
  /** Full pipeline definition */
  definition: PipelineDefinition;
  /** Unique target account IDs from all stages */
  targetAccountIds: string[];
  /** All stages with their account/region info */
  stages: Stage[];
  /** All pipeline steps */
  steps: PipelineStep[];
  /** Additional IAM policies from aws_additional_iam_policies.yaml */
  additionalPolicies: IamPolicy[];
}

/**
 * IAM policy document
 */
export interface IamPolicy {
  Version?: string;
  Statement: IamPolicyStatement[];
}

/**
 * IAM policy statement
 */
export interface IamPolicyStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}
