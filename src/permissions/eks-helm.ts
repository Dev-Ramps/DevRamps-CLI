/**
 * IAM permissions for DEVRAMPS:EKS:HELM step type
 *
 * Required for deploying Helm charts to EKS clusters.
 * The executor uses helm upgrade --install and helm status.
 * Same EKS permissions as eks-deploy since both use kubectl/Kubernetes API.
 */

import type { StepPermissions } from './index.js';

export const EKS_HELM_PERMISSIONS: StepPermissions = {
  actions: [
    // EKS cluster access
    'eks:DescribeCluster',
    'eks:AccessKubernetesApi',
    // EKS access entry management (for setting up kubectl/helm access)
    'eks:CreateAccessEntry',
    'eks:DescribeAccessEntry',
    'eks:AssociateAccessPolicy',
  ],
  // Resources are scoped to the specific cluster at deployment time
  resources: ['*'],
};
