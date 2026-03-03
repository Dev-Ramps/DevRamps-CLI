/**
 * IAM permissions for DEVRAMPS:LAMBDA:INVOKE step type
 *
 * Required for invoking Lambda functions.
 * The executor calls the function synchronously and returns its response.
 */

import type { StepPermissions } from './index.js';

export const LAMBDA_INVOKE_PERMISSIONS: StepPermissions = {
  actions: [
    // Invoke the Lambda function
    'lambda:InvokeFunction',
  ],
  resources: ['*'],
};
