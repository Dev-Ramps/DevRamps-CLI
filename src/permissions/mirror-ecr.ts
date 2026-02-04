/**
 * IAM permissions for DEVRAMPS:MIRROR:ECR step type
 *
 * Required for mirroring Docker images from source ECR to target ECR.
 * The executor pulls from source ECR and pushes to target ECR using docker CLI.
 */

import type { StepPermissions } from './index.js';

export const MIRROR_ECR_PERMISSIONS: StepPermissions = {
  actions: [
    // ECR authentication
    'ecr:GetAuthorizationToken',
    // Pull operations (source ECR)
    'ecr:BatchGetImage',
    'ecr:GetDownloadUrlForLayer',
    // Push operations (target ECR)
    'ecr:PutImage',
    'ecr:InitiateLayerUpload',
    'ecr:UploadLayerPart',
    'ecr:CompleteLayerUpload',
    'ecr:BatchCheckLayerAvailability',
  ],
  resources: ['*'],
};
