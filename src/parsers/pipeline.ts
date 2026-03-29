/**
 * Pipeline.yaml parser
 */

import { readFile, readdir, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { NoDevrampsFolderError, PipelineParseError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { parseAdditionalPolicies } from './additional-policies.js';
import type { PipelineDefinition, ParsedPipeline, PipelineStep, IamPolicy, Stage, EphemeralEnvironmentDef } from '../types/pipeline.js';

const DEVRAMPS_FOLDER = '.devramps';
const PIPELINE_FILE = 'pipeline.yaml';

export async function findDevrampsPipelines(
  basePath: string,
  filterSlugs?: string[]
): Promise<string[]> {
  const devrampsPath = join(basePath, DEVRAMPS_FOLDER);

  try {
    await access(devrampsPath, constants.R_OK);
  } catch {
    throw new NoDevrampsFolderError();
  }

  const entries = await readdir(devrampsPath, { withFileTypes: true });
  const pipelineSlugs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pipelinePath = join(devrampsPath, entry.name, PIPELINE_FILE);

    try {
      await access(pipelinePath, constants.R_OK);
      pipelineSlugs.push(entry.name);
    } catch {
      // No pipeline.yaml in this folder, skip
      logger.verbose(`Skipping ${entry.name}: no pipeline.yaml found`);
    }
  }

  if (filterSlugs && filterSlugs.length > 0) {
    const filtered = pipelineSlugs.filter(slug => filterSlugs.includes(slug));

    for (const slug of filterSlugs) {
      if (!pipelineSlugs.includes(slug)) {
        logger.warn(`Pipeline '${slug}' not found in ${DEVRAMPS_FOLDER}/`);
      }
    }

    return filtered;
  }

  return pipelineSlugs;
}

export async function parsePipeline(
  basePath: string,
  slug: string
): Promise<ParsedPipeline> {
  const pipelinePath = join(basePath, DEVRAMPS_FOLDER, slug, PIPELINE_FILE);

  logger.verbose(`Parsing pipeline: ${pipelinePath}`);

  let content: string;
  try {
    content = await readFile(pipelinePath, 'utf-8');
  } catch (error) {
    throw new PipelineParseError(slug, `Could not read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  let definition: PipelineDefinition;
  try {
    definition = parseYaml(content) as PipelineDefinition;
  } catch (error) {
    throw new PipelineParseError(slug, `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!definition.pipeline) {
    throw new PipelineParseError(slug, 'Missing "pipeline" key in definition');
  }

  if (!definition.pipeline.stages || definition.pipeline.stages.length === 0) {
    throw new PipelineParseError(slug, 'Pipeline must have at least one stage');
  }

  // Validate stages have required fields
  for (const stage of definition.pipeline.stages) {
    if (!stage.account_id) {
      throw new PipelineParseError(slug, `Stage "${stage.name}" is missing account_id`);
    }
    if (!stage.region) {
      throw new PipelineParseError(slug, `Stage "${stage.name}" is missing region`);
    }
  }

  // Validate ephemeral environments have required fields
  if (definition.pipeline.ephemeral_environments) {
    for (const [name, env] of Object.entries(definition.pipeline.ephemeral_environments)) {
      if (!env.account_id) {
        throw new PipelineParseError(slug, `Ephemeral environment "${name}" is missing account_id`);
      }
      if (!env.region) {
        throw new PipelineParseError(slug, `Ephemeral environment "${name}" is missing region`);
      }
    }
  }

  // Extract unique account IDs from stages and ephemeral environments
  const targetAccountIds = extractTargetAccountIds(definition);

  // Extract steps from pipeline level
  const steps = extractSteps(definition);

  // Parse additional IAM policies if present
  const additionalPolicies = await parseAdditionalPoliciesForPipeline(basePath, slug);

  // Combine regular stages with ephemeral environments (which need the same stage stacks)
  const ephemeralStages = ephemeralEnvironmentsAsStages(definition);
  const allStages = [...definition.pipeline.stages, ...ephemeralStages];

  if (ephemeralStages.length > 0) {
    logger.verbose(`Pipeline ${slug}: ${ephemeralStages.length} ephemeral environment(s) will be bootstrapped as stages`);
  }

  logger.verbose(`Pipeline ${slug}: ${targetAccountIds.length} accounts, ${allStages.length} stages, ${steps.length} steps`);

  return {
    slug,
    definition,
    targetAccountIds,
    stages: allStages,
    steps,
    additionalPolicies,
  };
}

function extractTargetAccountIds(definition: PipelineDefinition): string[] {
  const accountIds = new Set<string>();

  for (const stage of definition.pipeline.stages) {
    if (stage.account_id) {
      accountIds.add(stage.account_id);
    }
  }

  // Include ephemeral environment accounts
  if (definition.pipeline.ephemeral_environments) {
    for (const env of Object.values(definition.pipeline.ephemeral_environments)) {
      if (env.account_id) {
        accountIds.add(env.account_id);
      }
    }
  }

  return Array.from(accountIds);
}

/**
 * Convert ephemeral environment definitions to Stage objects for bootstrapping.
 * Ephemeral environments need the same stage stack resources (deployment role,
 * mirrored ECR/S3) as regular stages.
 */
function ephemeralEnvironmentsAsStages(
  definition: PipelineDefinition
): Stage[] {
  const envs = definition.pipeline.ephemeral_environments;
  if (!envs) return [];

  return Object.entries(envs).map(([name, env]: [string, EphemeralEnvironmentDef]) => ({
    name: `ephemeral-${name}`,
    account_id: env.account_id,
    region: env.region,
    skip: env.skip,
    vars: env.vars,
  }));
}

function extractSteps(definition: PipelineDefinition): PipelineStep[] {
  // New structure: steps are at pipeline.steps level
  return definition.pipeline.steps || [];
}

async function parseAdditionalPoliciesForPipeline(
  basePath: string,
  slug: string
): Promise<IamPolicy[]> {
  const pipelineDir = join(basePath, DEVRAMPS_FOLDER, slug);

  try {
    return await parseAdditionalPolicies(pipelineDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only suppress "file not found" — parsing/validation errors should surface
    if (message.includes('ENOENT') || message.includes('no such file')) {
      logger.verbose(`No additional policies file for ${slug}`);
      return [];
    }
    logger.warn(`Failed to parse additional policies for ${slug}: ${message}`);
    throw error;
  }
}
