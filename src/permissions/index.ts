/**
 * Step permissions registry
 *
 * Maps step types to their required IAM permissions.
 * Each step type has a corresponding permissions file that can be filled in.
 */

import { EKS_DEPLOY_PERMISSIONS } from './eks-deploy.js';
import { EKS_HELM_PERMISSIONS } from './eks-helm.js';
import { ECS_DEPLOY_PERMISSIONS } from './ecs-deploy.js';
import { APPROVAL_BAKE_PERMISSIONS } from './approval-bake.js';
import { getCustomPermissions } from './custom.js';

export interface StepPermissions {
  actions: string[];
  resources?: string[];
}

const PERMISSIONS_REGISTRY: Record<string, StepPermissions> = {
  'DEVRAMPS:EKS:DEPLOY': EKS_DEPLOY_PERMISSIONS,
  'DEVRAMPS:EKS:HELM': EKS_HELM_PERMISSIONS,
  'DEVRAMPS:ECS:DEPLOY': ECS_DEPLOY_PERMISSIONS,
  'DEVRAMPS:APPROVAL:BAKE': APPROVAL_BAKE_PERMISSIONS,
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
