/**
 * IAM permissions for DEVRAMPS:EKS:DEPLOY step type
 *
 * Required for deploying Kubernetes manifests to EKS clusters using kubectl.
 * The executor uses kubectl apply, kubectl set image, and kubectl rollout status.
 */

import type { StepPermissions } from './index.js';

export const EKS_DEPLOY_PERMISSIONS: StepPermissions = {
  actions: [
    // EKS cluster access
    'eks:DescribeCluster',
    'eks:AccessKubernetesApi',
    // EKS access entry management (for setting up kubectl access)
    'eks:CreateAccessEntry',
    'eks:DescribeAccessEntry',
    'eks:AssociateAccessPolicy',
  ],
  // Resources are scoped to the specific cluster at deployment time
  // '*' is used here as the specific cluster ARN is determined by the pipeline config
  resources: ['*'],
};
