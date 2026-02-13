/**
 * Artifact type definitions for pipeline artifacts
 *
 * Artifacts represent build outputs (Docker images, bundles) that are:
 * 1. Built/imported in the CI/CD account (root)
 * 2. Mirrored to stage accounts for deployment
 *
 * The `per_stage` flag determines:
 * - false/unset: Root resources in Pipeline Stack + mirrors in Stage Stacks
 * - true: Only Stage Stack resources (built separately per stage)
 */

/** Supported artifact types */
export type ArtifactType =
  | 'DEVRAMPS:DOCKER:BUILD'
  | 'DEVRAMPS:DOCKER:IMPORT'
  | 'DEVRAMPS:BUNDLE:BUILD'
  | 'DEVRAMPS:BUNDLE:IMPORT';

/** Docker-related artifact types */
export type DockerArtifactType = 'DEVRAMPS:DOCKER:BUILD' | 'DEVRAMPS:DOCKER:IMPORT';

/** Bundle-related artifact types */
export type BundleArtifactType = 'DEVRAMPS:BUNDLE:BUILD' | 'DEVRAMPS:BUNDLE:IMPORT';

/**
 * Base artifact interface matching pipeline.yaml schema
 */
export interface BaseArtifact {
  /** Artifact name (key from artifacts map in pipeline.yaml) */
  name: string;
  /** Optional ID for referencing in templates (defaults to normalized name) */
  id?: string;
  /** Artifact type */
  type: ArtifactType;
  /** CPU architecture for builds */
  architecture?: string;
  /** Host size for build agents */
  host_size?: string;
  /** If true, artifact is built/imported separately per stage (no root resource) */
  per_stage?: boolean;
  /** Paths that trigger rebuild when changed */
  rebuild_when_changed?: string[];
  /** Dependencies required for build */
  dependencies?: string[];
  /** Build parameters specific to artifact type */
  params?: Record<string, unknown>;
}

/**
 * Docker BUILD artifact - builds a Docker image from source
 */
export interface DockerBuildArtifact extends BaseArtifact {
  type: 'DEVRAMPS:DOCKER:BUILD';
  params?: {
    dockerfile?: string;
    args?: string[];
    [key: string]: unknown;
  };
}

/**
 * Docker IMPORT artifact - imports an external Docker image
 */
export interface DockerImportArtifact extends BaseArtifact {
  type: 'DEVRAMPS:DOCKER:IMPORT';
  params?: {
    source_image_url?: string;
    timeout_minutes?: number;
    [key: string]: unknown;
  };
}

/**
 * Bundle BUILD artifact - builds a bundle (zip, etc.) from source
 */
export interface BundleBuildArtifact extends BaseArtifact {
  type: 'DEVRAMPS:BUNDLE:BUILD';
  params?: {
    build_commands?: string;
    file_path?: string;
    [key: string]: unknown;
  };
}

/**
 * Bundle IMPORT artifact - imports an external bundle
 */
export interface BundleImportArtifact extends BaseArtifact {
  type: 'DEVRAMPS:BUNDLE:IMPORT';
  params?: {
    source_account?: string;
    source_region?: string;
    source_s3_url?: string;
    timeout_minutes?: number;
    [key: string]: unknown;
  };
}

/** Union type for all Docker artifacts */
export type DockerArtifact = DockerBuildArtifact | DockerImportArtifact;

/** Union type for all Bundle artifacts */
export type BundleArtifact = BundleBuildArtifact | BundleImportArtifact;

/** Union type for all import artifacts */
export type ImportArtifact = DockerImportArtifact | BundleImportArtifact;

/** Union type for any artifact */
export type Artifact = DockerArtifact | BundleArtifact;

/**
 * Parsed artifacts categorized by type
 */
export interface ParsedArtifacts {
  /** All Docker artifacts (BUILD and IMPORT) */
  docker: DockerArtifact[];
  /** All Bundle artifacts (BUILD and IMPORT) */
  bundle: BundleArtifact[];
}

/**
 * An external account that artifacts are imported from
 */
export interface ImportSourceAccount {
  accountId: string;
}

/**
 * Type guards for artifact types
 */
export function isDockerArtifact(artifact: BaseArtifact): artifact is DockerArtifact {
  return artifact.type === 'DEVRAMPS:DOCKER:BUILD' || artifact.type === 'DEVRAMPS:DOCKER:IMPORT';
}

export function isBundleArtifact(artifact: BaseArtifact): artifact is BundleArtifact {
  return artifact.type === 'DEVRAMPS:BUNDLE:BUILD' || artifact.type === 'DEVRAMPS:BUNDLE:IMPORT';
}

export function isPerStageArtifact(artifact: BaseArtifact): boolean {
  return artifact.per_stage === true;
}

/**
 * Get the artifact ID (used for resource naming)
 * Falls back to normalized name if id not specified
 */
export function getArtifactId(artifact: BaseArtifact): string {
  return artifact.id || artifact.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
}
