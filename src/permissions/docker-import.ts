/**
 * IAM permissions for DEVRAMPS:DOCKER:IMPORT step type
 *
 * Required for importing Docker images from CI/CD account ECR to deployment account ECR.
 * The executor polls for image availability, then pulls and pushes using docker CLI.
 */

import type { StepPermissions } from './index.js';

export const DOCKER_IMPORT_PERMISSIONS: StepPermissions = {
  actions: [
    // ECR authentication
    'ecr:GetAuthorizationToken',
    // Check image availability (source ECR)
    'ecr:DescribeImages',
    // Pull operations (source ECR)
    'ecr:BatchGetImage',
    'ecr:GetDownloadUrlForLayer',
    // Push operations (target ECR)
    'ecr:PutImage',
    'ecr:InitiateLayerUpload',
    'ecr:UploadLayerPart',
    'ecr:CompleteLayerUpload',
    'ecr:BatchCheckLayerAvailability',
    // Cross-account role assumption
    'sts:AssumeRole',
  ],
  resources: ['*'],
};
