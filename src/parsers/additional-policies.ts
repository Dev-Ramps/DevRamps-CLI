/**
 * Parser for additional IAM policies (aws_additional_iam_policies.json/yaml)
 */

import { readFile, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import * as logger from '../utils/logger.js';
import type { IamPolicy } from '../types/pipeline.js';

const POLICIES_JSON = 'aws_additional_iam_policies.json';
const POLICIES_YAML = 'aws_additional_iam_policies.yaml';

export async function parseAdditionalPolicies(pipelineDir: string): Promise<IamPolicy[]> {
  // Try JSON first, then YAML
  const jsonPath = join(pipelineDir, POLICIES_JSON);
  const yamlPath = join(pipelineDir, POLICIES_YAML);

  let content: string | undefined;
  let format: 'json' | 'yaml' | undefined;

  try {
    await access(jsonPath, constants.R_OK);
    content = await readFile(jsonPath, 'utf-8');
    format = 'json';
    logger.verbose(`Found additional policies: ${POLICIES_JSON}`);
  } catch {
    // Try YAML
    try {
      await access(yamlPath, constants.R_OK);
      content = await readFile(yamlPath, 'utf-8');
      format = 'yaml';
      logger.verbose(`Found additional policies: ${POLICIES_YAML}`);
    } catch {
      // Neither file exists
      return [];
    }
  }

  if (!content || !format) {
    return [];
  }

  let policies: unknown;

  try {
    if (format === 'json') {
      policies = JSON.parse(content);
    } else {
      policies = parseYaml(content);
    }
  } catch (error) {
    throw new Error(`Failed to parse ${format === 'json' ? POLICIES_JSON : POLICIES_YAML}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(policies)) {
    throw new Error(`Additional policies file must contain an array of IAM policies`);
  }

  // Validate each policy has the expected structure
  const validatedPolicies: IamPolicy[] = [];

  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i];

    if (!policy || typeof policy !== 'object') {
      throw new Error(`Policy at index ${i} is not an object`);
    }

    if (!('Statement' in policy) || !Array.isArray(policy.Statement)) {
      throw new Error(`Policy at index ${i} is missing Statement array`);
    }

    validatedPolicies.push(policy as IamPolicy);
  }

  logger.verbose(`Loaded ${validatedPolicies.length} additional policies`);

  return validatedPolicies;
}
