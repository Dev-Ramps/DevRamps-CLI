/**
 * IAM permissions for DEVRAMPS:ECS:RUN_TASK step type
 *
 * Required for running one-off Fargate tasks during deployments.
 * The executor describes the task definition, launches the task via RunTask,
 * polls DescribeTasks for completion, and streams container logs from CloudWatch.
 */

import type { StepPermissions } from './index.js';

export const ECS_RUN_TASK_PERMISSIONS: StepPermissions = {
  actions: [
    // Task operations
    'ecs:RunTask',
    'ecs:DescribeTasks',
    // Task definition lookup (to extract log configuration)
    'ecs:DescribeTaskDefinition',
    // Required for ECS to assume task/execution roles
    'iam:PassRole',
    // CloudWatch log streaming
    'logs:GetLogEvents',
  ],
  resources: ['*'],
};
