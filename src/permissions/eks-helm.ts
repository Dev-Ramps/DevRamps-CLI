/**
 * IAM permissions for DEVRAMPS:EKS:HELM step type
 */

import type { StepPermissions } from './index.js';

export const EKS_HELM_PERMISSIONS: StepPermissions = {
  actions: [
    // TODO: Fill in the actual permissions needed for EKS Helm deployments
    // Example permissions that might be needed:
    // 'eks:DescribeCluster',
    // 'eks:ListClusters',
    // 'eks:AccessKubernetesApi',
  ],
  resources: ['*'],
};
