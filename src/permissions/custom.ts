/**
 * Fallback permissions for custom step types (CUSTOM:*)
 *
 * Custom step types are user-defined and their permissions should be specified
 * in the additional IAM policies file. This module provides a fallback
 * that returns empty permissions.
 */

import type { StepPermissions } from './index.js';
import * as logger from '../utils/logger.js';

/**
 * Get permissions for a custom step type
 *
 * Custom steps should define their permissions in aws_additional_iam_policies.yaml/json.
 * This function returns empty permissions to ensure the step is included in the
 * policy naming but relies on additional policies for actual permissions.
 */
export function getCustomPermissions(stepType: string): StepPermissions {
  logger.verbose(
    `Step type '${stepType}' is a custom step. ` +
    `Ensure permissions are defined in aws_additional_iam_policies.yaml/json`
  );

  return {
    actions: [],
    resources: [],
  };
}
