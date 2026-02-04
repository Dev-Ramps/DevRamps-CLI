/**
 * Artifact parser - extracts and categorizes artifacts from pipeline definition
 */

import type { PipelineDefinition, RawArtifact } from '../types/pipeline.js';
import type {
  ParsedArtifacts,
  DockerArtifact,
  BundleArtifact,
  DockerBuildArtifact,
  DockerImportArtifact,
  BundleBuildArtifact,
  BundleImportArtifact,
  ArtifactType,
} from '../types/artifacts.js';
import * as logger from '../utils/logger.js';

/**
 * Valid artifact types
 */
const DOCKER_TYPES: ArtifactType[] = ['DEVRAMPS:DOCKER:BUILD', 'DEVRAMPS:DOCKER:IMPORT'];
const BUNDLE_TYPES: ArtifactType[] = ['DEVRAMPS:BUNDLE:BUILD', 'DEVRAMPS:BUNDLE:IMPORT'];
const VALID_TYPES: ArtifactType[] = [...DOCKER_TYPES, ...BUNDLE_TYPES];

/**
 * Parse and categorize artifacts from a pipeline definition
 */
export function parseArtifacts(definition: PipelineDefinition): ParsedArtifacts {
  const docker: DockerArtifact[] = [];
  const bundle: BundleArtifact[] = [];

  const rawArtifacts = definition.pipeline.artifacts;

  if (!rawArtifacts) {
    return { docker, bundle };
  }

  for (const [name, raw] of Object.entries(rawArtifacts)) {
    const artifact = parseArtifact(name, raw);

    if (!artifact) {
      continue;
    }

    if (DOCKER_TYPES.includes(artifact.type as ArtifactType)) {
      docker.push(artifact as DockerArtifact);
    } else if (BUNDLE_TYPES.includes(artifact.type as ArtifactType)) {
      bundle.push(artifact as BundleArtifact);
    }
  }

  logger.verbose(`Parsed artifacts: ${docker.length} docker, ${bundle.length} bundle`);

  return { docker, bundle };
}

/**
 * Parse a single artifact from raw definition
 */
function parseArtifact(
  name: string,
  raw: RawArtifact
): DockerArtifact | BundleArtifact | null {
  if (!raw.type) {
    logger.warn(`Artifact "${name}" is missing type, skipping`);
    return null;
  }

  if (!VALID_TYPES.includes(raw.type as ArtifactType)) {
    logger.warn(`Artifact "${name}" has unknown type "${raw.type}", skipping`);
    return null;
  }

  const base = {
    name,
    id: raw.id,
    type: raw.type as ArtifactType,
    architecture: raw.architecture,
    host_size: raw.host_size,
    per_stage: raw.per_stage,
    rebuild_when_changed: raw.rebuild_when_changed,
    dependencies: raw.dependencies,
    params: raw.params,
  };

  switch (raw.type) {
    case 'DEVRAMPS:DOCKER:BUILD':
      return base as DockerBuildArtifact;

    case 'DEVRAMPS:DOCKER:IMPORT':
      return base as DockerImportArtifact;

    case 'DEVRAMPS:BUNDLE:BUILD':
      return base as BundleBuildArtifact;

    case 'DEVRAMPS:BUNDLE:IMPORT':
      return base as BundleImportArtifact;

    default:
      return null;
  }
}

/**
 * Filter artifacts for pipeline stack (non per_stage only)
 */
export function filterArtifactsForPipelineStack(artifacts: ParsedArtifacts): ParsedArtifacts {
  return {
    docker: artifacts.docker.filter(a => !a.per_stage),
    bundle: artifacts.bundle.filter(a => !a.per_stage),
  };
}

/**
 * Get all artifacts (for stage stacks, which get all artifacts)
 */
export function getAllArtifacts(artifacts: ParsedArtifacts): ParsedArtifacts {
  return artifacts;
}

/**
 * Get artifact ID for resource naming
 * Falls back to normalized name if id not specified
 */
export function getArtifactId(artifact: { name: string; id?: string }): string {
  if (artifact.id) {
    return artifact.id;
  }
  // Normalize name: lowercase, replace non-alphanumeric with hyphens
  return artifact.name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
