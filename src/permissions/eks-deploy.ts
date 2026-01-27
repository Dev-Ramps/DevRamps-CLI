/**
 * IAM permissions for DEVRAMPS:EKS:DEPLOY step type
 */

import type { StepPermissions } from './index.js';

export const EKS_DEPLOY_PERMISSIONS: StepPermissions = {
  actions: [
    // TODO: Fill in the actual permissions needed for EKS deployment
    // Example permissions that might be needed:
    // 'eks:DescribeCluster',
    // 'eks:ListClusters',
    // 'eks:AccessKubernetesApi',
  ],
  resources: ['*'],
};
