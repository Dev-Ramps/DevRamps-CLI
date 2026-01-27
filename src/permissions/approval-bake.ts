/**
 * IAM permissions for DEVRAMPS:APPROVAL:BAKE step type
 *
 * The bake step is a wait/approval step that doesn't require any AWS permissions
 * since it's purely a timing/approval mechanism.
 */

import type { StepPermissions } from './index.js';

export const APPROVAL_BAKE_PERMISSIONS: StepPermissions = {
  actions: [],
  resources: [],
};
