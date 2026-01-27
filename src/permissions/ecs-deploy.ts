/**
 * IAM permissions for DEVRAMPS:ECS:DEPLOY step type
 */

import type { StepPermissions } from './index.js';

export const ECS_DEPLOY_PERMISSIONS: StepPermissions = {
  actions: [
    // TODO: Fill in the actual permissions needed for ECS deployment
    // Example permissions that might be needed:
    // 'ecs:DescribeServices',
    // 'ecs:UpdateService',
    // 'ecs:DescribeTaskDefinition',
    // 'ecs:RegisterTaskDefinition',
    // 'ecs:DescribeClusters',
  ],
  resources: ['*'],
};
