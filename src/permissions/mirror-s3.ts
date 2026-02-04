/**
 * IAM permissions for DEVRAMPS:MIRROR:S3 step type
 *
 * Required for mirroring S3 objects from source bucket to target bucket.
 * The executor downloads from source and uploads to target using AWS CLI.
 */

import type { StepPermissions } from './index.js';

export const MIRROR_S3_PERMISSIONS: StepPermissions = {
  actions: [
    // Read operations (source bucket)
    's3:GetObject',
    's3:HeadObject',
    // Write operations (target bucket)
    's3:PutObject',
    's3:PutObjectAcl',
  ],
  resources: ['*'],
};
