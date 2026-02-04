/**
 * Extensible merge strategy interface
 *
 * Merge strategies allow the CLI to handle resources that need to be
 * "merged" rather than simply overwritten when updating stacks.
 *
 * Example use case: The Terraform state bucket policy needs to allow
 * all target accounts across all pipelines. When a new pipeline is added,
 * we need to merge the new accounts with existing accounts, not replace them.
 *
 * Each resource type that requires merging implements this interface.
 * The system can be extended by adding new strategy implementations.
 */

import type { ParsedPipeline } from '../types/pipeline.js';

/**
 * Context provided to merge strategies
 */
export interface MergeContext {
  orgSlug: string;
  cicdAccountId: string;
  cicdRegion: string;
  /** All pipelines being processed */
  pipelines: ParsedPipeline[];
}

/**
 * Validation result from merge strategy
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Existing CloudFormation stack resources for reading current state
 */
export interface CloudFormationStackResources {
  stackName: string;
  accountId: string;
  region: string;
  /** Stack resource summaries from DescribeStackResources */
  resources: Record<string, unknown>;
  /** Stack outputs from DescribeStacks */
  outputs: Record<string, string>;
}

/**
 * Generic merge strategy interface
 *
 * @typeParam TExisting - Type of data extracted from existing stack
 * @typeParam TNew - Type of new data to merge
 * @typeParam TResult - Type of merged result
 */
export interface MergeStrategy<TExisting, TNew, TResult> {
  /**
   * Unique identifier for this merge strategy
   */
  readonly strategyId: string;

  /**
   * Human-readable name for logging
   */
  readonly displayName: string;

  /**
   * Extract existing state from CloudFormation stack.
   * Returns null if the resource doesn't exist or can't be read.
   *
   * @param stackResources - Current stack resources and outputs
   */
  extractExisting(stackResources: CloudFormationStackResources): Promise<TExisting | null>;

  /**
   * Collect new data that should be merged.
   * This scans all relevant sources (e.g., all pipelines) to build
   * the complete set of new data.
   *
   * @param context - Merge context with org info and pipelines
   */
  collectNew(context: MergeContext): Promise<TNew>;

  /**
   * Merge existing and new data.
   * If existing is null (no current state), just returns processed new data.
   *
   * @param existing - Existing state (or null if none)
   * @param newData - New data to merge
   */
  merge(existing: TExisting | null, newData: TNew): TResult;

  /**
   * Validate the merged result before applying.
   * Can check for issues like too many principals, invalid formats, etc.
   *
   * @param result - The merged result to validate
   */
  validate(result: TResult): ValidationResult;
}

/**
 * Base class for merge strategies providing common functionality
 */
export abstract class BaseMergeStrategy<TExisting, TNew, TResult>
  implements MergeStrategy<TExisting, TNew, TResult>
{
  abstract readonly strategyId: string;
  abstract readonly displayName: string;

  abstract extractExisting(stackResources: CloudFormationStackResources): Promise<TExisting | null>;
  abstract collectNew(context: MergeContext): Promise<TNew>;
  abstract merge(existing: TExisting | null, newData: TNew): TResult;

  /**
   * Default validation - always valid. Override for specific validation.
   */
  validate(result: TResult): ValidationResult {
    return { valid: true };
  }
}
