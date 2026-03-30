/**
 * login command
 *
 * Authenticates with DevRamps via browser OAuth and stores
 * credentials in ~/.devramps/configuration.json for future use.
 */

import chalk from 'chalk';
import { authenticateViaBrowser } from '../auth/browser-auth.js';
import { saveCredentials, getCredentialsPath } from '../auth/credential-store.js';
import * as logger from '../utils/logger.js';
import { DevRampsError } from '../utils/errors.js';

interface LoginOptions {
  endpointOverride?: string;
}

export async function loginCommand(options: LoginOptions) {
  try {
    const authData = await authenticateViaBrowser({
      endpointOverride: options.endpointOverride,
    });

    await saveCredentials(authData, authData.expiresIn);

    logger.newline();
    logger.success(`Logged in to ${chalk.bold(authData.orgSlug)}`);
    logger.info(`  Organization: ${authData.orgSlug}`);
    logger.info(`  CI/CD Account: ${authData.cicdAccountId}`);
    logger.info(`  Region: ${authData.cicdRegion}`);
    logger.info(`  Credentials saved to ${chalk.dim(getCredentialsPath())}`);
    logger.newline();
    logger.info('You can now use DevRamps CLI commands without re-authenticating.');
    logger.info(`Run ${chalk.cyan('npx @devramps/cli login')} again to switch organizations or refresh credentials.`);
  } catch (error) {
    if (error instanceof DevRampsError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
