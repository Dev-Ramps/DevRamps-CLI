/**
 * Stack deployment types for the three-stack model:
 * - Org Stack: One per org in CI/CD account
 * - Pipeline Stack: One per pipeline in CI/CD account
 * - Stage Stack: One per stage in stage's account/region
 */

import type { PipelineStep, IamPolicy } from './pipeline.js';
import type { DockerArtifact, BundleArtifact } from './artifacts.js';

export enum StackType {
  ORG = 'Org',
  PIPELINE = 'Pipeline',
  STAGE = 'Stage',
}

export interface BaseStackDeployment {
  stackType: StackType;
  stackName: string;
  accountId: string;
  region: string;
  action: 'CREATE' | 'UPDATE';
}

/**
 * Org Stack - deployed once per organization in the CI/CD account
 * Contains: OIDC provider, org-wide CICD role, KMS key, Terraform state bucket
 */
export interface OrgStackDeployment extends BaseStackDeployment {
  stackType: StackType.ORG;
  orgSlug: string;
  /** All target account IDs that need access to the Terraform state bucket */
  targetAccountIds: string[];
}

/**
 * Pipeline Stack - deployed once per pipeline in the CI/CD account
 * Contains: Root ECR repos and S3 buckets for artifacts (where per_stage is false)
 */
export interface PipelineStackDeployment extends BaseStackDeployment {
  stackType: StackType.PIPELINE;
  pipelineSlug: string;
  /** Docker artifacts that need root ECR repos (per_stage: false or unset) */
  dockerArtifacts: DockerArtifact[];
  /** Bundle artifacts that need root S3 buckets (per_stage: false or unset) */
  bundleArtifacts: BundleArtifact[];
}

/**
 * Stage Stack - deployed once per stage in the stage's account/region
 * Contains: Stage deployment role, mirrored ECR repos and S3 buckets
 */
export interface StageStackDeployment extends BaseStackDeployment {
  stackType: StackType.STAGE;
  pipelineSlug: string;
  stageName: string;
  orgSlug: string;
  /** All steps in the pipeline (for permission generation) */
  steps: PipelineStep[];
  /** Additional IAM policies from aws_additional_iam_policies.yaml */
  additionalPolicies: IamPolicy[];
  /** All Docker artifacts (for stage ECR repos) */
  dockerArtifacts: DockerArtifact[];
  /** All Bundle artifacts (for stage S3 buckets) */
  bundleArtifacts: BundleArtifact[];
}

export type StackDeployment = OrgStackDeployment | PipelineStackDeployment | StageStackDeployment;

/**
 * Complete deployment plan containing all three stack types
 */
export interface DeploymentPlan {
  orgSlug: string;
  cicdAccountId: string;
  cicdRegion: string;
  orgStack: OrgStackDeployment;
  pipelineStacks: PipelineStackDeployment[];
  stageStacks: StageStackDeployment[];
}

/**
 * Type guards for stack types
 */
export function isOrgStack(stack: StackDeployment): stack is OrgStackDeployment {
  return stack.stackType === StackType.ORG;
}

export function isPipelineStack(stack: StackDeployment): stack is PipelineStackDeployment {
  return stack.stackType === StackType.PIPELINE;
}

export function isStageStack(stack: StackDeployment): stack is StageStackDeployment {
  return stack.stackType === StackType.STAGE;
}
