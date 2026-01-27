/**
 * Pipeline.yaml parser
 */

import { readFile, readdir, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { NoDevrampsFolderError, PipelineParseError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { parseAdditionalPolicies } from './additional-policies.js';
import type { PipelineDefinition, ParsedPipeline, PipelineStep, IamPolicy } from '../types/pipeline.js';

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

  // Extract unique account IDs from stages
  const targetAccountIds = extractTargetAccountIds(definition);

  // Extract steps from defaults
  const steps = extractSteps(definition);

  // Parse additional IAM policies if present
  const additionalPolicies = await parseAdditionalPoliciesForPipeline(basePath, slug);

  logger.verbose(`Pipeline ${slug}: ${targetAccountIds.length} accounts, ${steps.length} steps`);

  return {
    slug,
    definition,
    targetAccountIds,
    steps,
    additionalPolicies,
  };
}

function extractTargetAccountIds(definition: PipelineDefinition): string[] {
  const accountIds = new Set<string>();

  for (const stage of definition.pipeline.stages) {
    if (stage.deployment_target?.account_id) {
      accountIds.add(stage.deployment_target.account_id);
    }
  }

  return Array.from(accountIds);
}

function extractSteps(definition: PipelineDefinition): PipelineStep[] {
  const steps: PipelineStep[] = [];

  // Get steps from defaults
  if (definition.pipeline.defaults?.steps) {
    steps.push(...definition.pipeline.defaults.steps);
  }

  // Get steps from individual stages (if they have their own steps)
  for (const stage of definition.pipeline.stages) {
    // Stages might have stage-specific steps in the future
    // For now, we rely on the defaults
  }

  return steps;
}

async function parseAdditionalPoliciesForPipeline(
  basePath: string,
  slug: string
): Promise<IamPolicy[]> {
  const pipelineDir = join(basePath, DEVRAMPS_FOLDER, slug);

  try {
    return await parseAdditionalPolicies(pipelineDir);
  } catch (error) {
    logger.verbose(`No additional policies for ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
