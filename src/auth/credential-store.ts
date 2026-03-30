/**
 * Persistent credential storage at ~/.devramps/configuration.json
 *
 * Stores and retrieves DevRamps authentication data so users
 * don't need to re-authenticate on every CLI invocation.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as logger from '../utils/logger.js';
import type { AuthData } from '../types/config.js';

const DEVRAMPS_DIR = '.devramps';
const CONFIG_FILE = 'configuration.json';

export interface StoredCredentials {
  accessToken: string;
  organizationId: string;
  orgSlug: string;
  cicdAccountId: string;
  cicdRegion: string;
  apiBaseUrl: string;
  expiresAt: string; // ISO 8601
}

function getConfigPath(): string {
  return join(homedir(), DEVRAMPS_DIR, CONFIG_FILE);
}

function getConfigDir(): string {
  return join(homedir(), DEVRAMPS_DIR);
}

/**
 * Save auth data to ~/.devramps/configuration.json
 */
export async function saveCredentials(authData: AuthData, expiresInSeconds: number): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const stored: StoredCredentials = {
    accessToken: authData.accessToken,
    organizationId: authData.organizationId,
    orgSlug: authData.orgSlug,
    cicdAccountId: authData.cicdAccountId,
    cicdRegion: authData.cicdRegion,
    apiBaseUrl: authData.apiBaseUrl,
    expiresAt,
  };

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(stored, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600, // Owner read/write only
  });

  logger.verbose(`Credentials saved to ${configPath}`);
}

/**
 * Load stored credentials from ~/.devramps/configuration.json
 * Returns null if no credentials exist or they are expired.
 */
export async function loadCredentials(): Promise<AuthData | null> {
  const configPath = getConfigPath();

  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch {
    return null;
  }

  let stored: StoredCredentials;
  try {
    stored = JSON.parse(content);
  } catch {
    logger.verbose('Failed to parse credentials file, treating as missing');
    return null;
  }

  // Validate required fields
  if (!stored.accessToken || !stored.organizationId || !stored.orgSlug || !stored.expiresAt) {
    logger.verbose('Credentials file is missing required fields');
    return null;
  }

  // Check expiry
  const expiresAt = new Date(stored.expiresAt);
  if (expiresAt <= new Date()) {
    logger.verbose('Stored credentials have expired');
    return null;
  }

  return {
    accessToken: stored.accessToken,
    organizationId: stored.organizationId,
    orgSlug: stored.orgSlug,
    cicdAccountId: stored.cicdAccountId,
    cicdRegion: stored.cicdRegion,
    apiBaseUrl: stored.apiBaseUrl,
  };
}

/**
 * Check if stored credentials exist and are valid (not expired)
 */
export async function hasValidCredentials(): Promise<boolean> {
  const creds = await loadCredentials();
  return creds !== null;
}

/**
 * Get the path to the credentials file (for display to users)
 */
export function getCredentialsPath(): string {
  return getConfigPath();
}
