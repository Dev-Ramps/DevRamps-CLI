/**
 * Merge system exports and registry
 *
 * Provides a central registry for merge strategies and helper functions
 * for executing merges.
 */

import type { MergeStrategy, MergeContext, CloudFormationStackResources, ValidationResult } from './strategy.js';
import { BucketPolicyMergeStrategy, type BucketPolicyData } from './bucket-policy.js';
import * as logger from '../utils/logger.js';

// Registry of all merge strategies
const MERGE_STRATEGIES: Map<string, MergeStrategy<unknown, unknown, unknown>> = new Map();

// Pre-instantiated strategies
const bucketPolicyStrategy = new BucketPolicyMergeStrategy();

// Register default strategies
MERGE_STRATEGIES.set(bucketPolicyStrategy.strategyId, bucketPolicyStrategy);

/**
 * Register a custom merge strategy
 */
export function registerMergeStrategy(strategy: MergeStrategy<unknown, unknown, unknown>): void {
  if (MERGE_STRATEGIES.has(strategy.strategyId)) {
    logger.warn(`Overwriting existing merge strategy: ${strategy.strategyId}`);
  }
  MERGE_STRATEGIES.set(strategy.strategyId, strategy);
}

/**
 * Get a merge strategy by ID
 */
export function getMergeStrategy(strategyId: string): MergeStrategy<unknown, unknown, unknown> | undefined {
  return MERGE_STRATEGIES.get(strategyId);
}

/**
 * Get the bucket policy merge strategy (typed)
 */
export function getBucketPolicyStrategy(): BucketPolicyMergeStrategy {
  return bucketPolicyStrategy;
}

/**
 * Execute a merge operation
 *
 * @param strategyId - ID of the merge strategy to use
 * @param existingStack - Existing stack resources (or null if new stack)
 * @param context - Merge context with pipelines and org info
 * @returns The merged result
 */
export async function executeMerge<T>(
  strategyId: string,
  existingStack: CloudFormationStackResources | null,
  context: MergeContext
): Promise<T> {
  const strategy = getMergeStrategy(strategyId);

  if (!strategy) {
    throw new Error(`Unknown merge strategy: ${strategyId}`);
  }

  logger.verbose(`Executing merge strategy: ${strategy.displayName}`);

  // Extract existing state if stack exists
  const existing = existingStack
    ? await strategy.extractExisting(existingStack)
    : null;

  // Collect new data from context
  const newData = await strategy.collectNew(context);

  // Perform the merge
  const merged = strategy.merge(existing, newData);

  // Validate the result
  const validation = strategy.validate(merged);

  if (validation.warnings) {
    for (const warning of validation.warnings) {
      logger.warn(`[${strategy.displayName}] ${warning}`);
    }
  }

  if (!validation.valid) {
    const errors = validation.errors?.join(', ') || 'Unknown validation error';
    throw new Error(`Merge validation failed for ${strategy.displayName}: ${errors}`);
  }

  logger.verbose(`Merge complete: ${strategy.displayName}`);

  return merged as T;
}

/**
 * Execute bucket policy merge specifically
 * Convenience function with proper typing
 */
export async function executeBucketPolicyMerge(
  existingStack: CloudFormationStackResources | null,
  context: MergeContext
): Promise<BucketPolicyData> {
  return executeMerge<BucketPolicyData>(
    'terraform-state-bucket-policy',
    existingStack,
    context
  );
}

// Re-export types
export type { MergeStrategy, MergeContext, ValidationResult, CloudFormationStackResources } from './strategy.js';
export type { BucketPolicyData } from './bucket-policy.js';
export { createTerraformStateBucketPolicy } from './bucket-policy.js';
