/**
 * IAM permissions for DEVRAMPS:BUNDLE:IMPORT step type
 *
 * Required for importing bundle artifacts from CI/CD account to deployment account.
 * The executor downloads from source S3 and uploads to target S3 with cross-account access.
 */

import type { StepPermissions } from './index.js';

export const BUNDLE_IMPORT_PERMISSIONS: StepPermissions = {
  actions: [
    // Read operations (source bucket in CI/CD account)
    's3:GetObject',
    's3:HeadObject',
    // Write operations (target bucket in deployment account)
    's3:PutObject',
    's3:PutObjectAcl',
    // Cross-account role assumption
    'sts:AssumeRole',
  ],
  resources: ['*'],
};
