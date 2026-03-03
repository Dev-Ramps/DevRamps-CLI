/**
 * IAM permissions for DEVRAMPS:CLOUDFRONT:INVALIDATE step type
 *
 * Required for creating and monitoring CloudFront invalidations.
 * The executor creates an invalidation and polls until it completes.
 */

import type { StepPermissions } from './index.js';

export const CLOUDFRONT_INVALIDATE_PERMISSIONS: StepPermissions = {
  actions: [
    // Create invalidation
    'cloudfront:CreateInvalidation',
    // Poll for invalidation completion
    'cloudfront:GetInvalidation',
  ],
  resources: ['*'],
};
