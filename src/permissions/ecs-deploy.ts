/**
 * IAM permissions for DEVRAMPS:ECS:DEPLOY step type
 *
 * Required for deploying container images to ECS services.
 * The executor fetches the reference task definition, creates a new revision
 * with the updated image, and triggers a service update.
 */

import type { StepPermissions } from './index.js';

export const ECS_DEPLOY_PERMISSIONS: StepPermissions = {
  actions: [
    // ECS service operations
    'ecs:UpdateService',
    'ecs:DescribeServices',
    // Task definition operations
    'ecs:DescribeTaskDefinition',
    'ecs:RegisterTaskDefinition',
    // Required for ECS to use task/execution roles
    'iam:PassRole',
  ],
  // Resources are scoped to the specific cluster/service at deployment time
  resources: ['*'],
};
