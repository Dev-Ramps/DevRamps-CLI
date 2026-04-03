/**
 * Step permissions registry
 *
 * Maps step types to their required IAM permissions.
 * Each step type has a corresponding permissions file.
 */

import { EKS_DEPLOY_PERMISSIONS } from './eks-deploy.js';
import { EKS_HELM_PERMISSIONS } from './eks-helm.js';
import { ECS_DEPLOY_PERMISSIONS } from './ecs-deploy.js';
import { ECS_RUN_TASK_PERMISSIONS } from './ecs-run-task.js';
import { APPROVAL_BAKE_PERMISSIONS } from './approval-bake.js';
import { APPROVAL_TEST_PERMISSIONS } from './approval-test.js';
import { MIRROR_ECR_PERMISSIONS } from './mirror-ecr.js';
import { MIRROR_S3_PERMISSIONS } from './mirror-s3.js';
import { BUNDLE_IMPORT_PERMISSIONS } from './bundle-import.js';
import { DOCKER_IMPORT_PERMISSIONS } from './docker-import.js';
import { LAMBDA_DEPLOY_PERMISSIONS } from './lambda-deploy.js';
import { LAMBDA_INVOKE_PERMISSIONS } from './lambda-invoke.js';
import { CLOUDFRONT_INVALIDATE_PERMISSIONS } from './cloudfront-invalidate.js';
import { getCustomPermissions } from './custom.js';

export interface StepPermissions {
  actions: string[];
  resources?: string[];
}

const PERMISSIONS_REGISTRY: Record<string, StepPermissions> = {
  // Deployment steps
  'DEVRAMPS:EKS:DEPLOY': EKS_DEPLOY_PERMISSIONS,
  'DEVRAMPS:EKS:HELM': EKS_HELM_PERMISSIONS,
  'DEVRAMPS:ECS:DEPLOY': ECS_DEPLOY_PERMISSIONS,
  'DEVRAMPS:ECS:RUN_TASK': ECS_RUN_TASK_PERMISSIONS,
  'DEVRAMPS:LAMBDA:DEPLOY': LAMBDA_DEPLOY_PERMISSIONS,
  'DEVRAMPS:LAMBDA:INVOKE': LAMBDA_INVOKE_PERMISSIONS,
  'DEVRAMPS:CLOUDFRONT:INVALIDATE': CLOUDFRONT_INVALIDATE_PERMISSIONS,

  // Artifact mirroring steps (CI/CD account -> deployment account)
  'DEVRAMPS:MIRROR:ECR': MIRROR_ECR_PERMISSIONS,
  'DEVRAMPS:MIRROR:S3': MIRROR_S3_PERMISSIONS,

  // Artifact import steps (cross-account)
  'DEVRAMPS:BUNDLE:IMPORT': BUNDLE_IMPORT_PERMISSIONS,
  'DEVRAMPS:DOCKER:IMPORT': DOCKER_IMPORT_PERMISSIONS,

  // Approval/wait steps (no AWS permissions needed)
  'DEVRAMPS:APPROVAL:BAKE': APPROVAL_BAKE_PERMISSIONS,
  'DEVRAMPS:APPROVAL:TEST': APPROVAL_TEST_PERMISSIONS,
};

/**
 * Get the IAM permissions required for a given step type
 */
export function getStepPermissions(stepType: string): StepPermissions {
  // Check registry for known step types
  const permissions = PERMISSIONS_REGISTRY[stepType];

  if (permissions) {
    return permissions;
  }

  // Check for custom step types
  if (stepType.startsWith('CUSTOM:')) {
    return getCustomPermissions(stepType);
  }

  // Unknown step type - return empty permissions
  // This allows the CLI to continue without failing for unrecognized steps
  return {
    actions: [],
    resources: [],
  };
}

/**
 * Get all unique step types from a list of step types
 */
export function getUniqueStepTypes(stepTypes: string[]): string[] {
  return [...new Set(stepTypes)];
}

/**
 * Check if a step type has any permissions defined
 */
export function hasPermissions(stepType: string): boolean {
  const permissions = getStepPermissions(stepType);
  return permissions.actions.length > 0;
}
