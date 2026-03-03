/**
 * IAM permissions for DEVRAMPS:LAMBDA:DEPLOY step type
 *
 * Required for deploying code to Lambda functions.
 * The executor updates the function code and polls for completion.
 */

import type { StepPermissions } from './index.js';

export const LAMBDA_DEPLOY_PERMISSIONS: StepPermissions = {
  actions: [
    // Update function code (S3 bundle or container image)
    'lambda:UpdateFunctionCode',
    // Poll for update completion
    'lambda:GetFunctionConfiguration',
    'lambda:GetFunction',
  ],
  resources: ['*'],
};
