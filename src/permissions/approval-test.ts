/**
 * IAM permissions for DEVRAMPS:APPROVAL:TEST step type
 *
 * The test approval step is a wait/approval step that doesn't require any AWS permissions
 * since it's purely a testing/approval mechanism.
 */

import type { StepPermissions } from './index.js';

export const APPROVAL_TEST_PERMISSIONS: StepPermissions = {
  actions: [],
  resources: [],
};
