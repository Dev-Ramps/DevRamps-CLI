/**
 * Browser-based authentication flow for DevRamps
 *
 * Opens a browser to devramps.com for the user to authenticate and select
 * their organization. The org data is returned to the CLI via a local callback.
 */

import express from 'express';
import open from 'open';
import { createServer, type Server } from 'node:http';
import { AuthenticationError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import type { AuthData } from '../types/config.js';

const DEFAULT_AUTH_BASE_URL = 'https://devramps.com';
const AUTH_PATH = '/cli/auth';
const CALLBACK_PATH = '/callback';
const AUTH_TIMEOUT_MS = 300000; // 5 minutes

interface CallbackData {
  orgSlug?: string;
  error?: string;
}

export interface AuthOptions {
  endpointOverride?: string;
}

/**
 * Start the browser authentication flow
 *
 * 1. Starts a local Express server on a random available port
 * 2. Opens the browser to devramps.com/cli/auth with the callback URL
 * 3. Waits for the callback with the org data
 * 4. Returns the org slug and other data
 *
 * @param options.endpointOverride - Override the base URL (e.g., http://localhost:3000 for testing)
 */
export async function authenticateViaBrowser(options: AuthOptions = {}): Promise<AuthData> {
  const baseUrl = options.endpointOverride || DEFAULT_AUTH_BASE_URL;

  logger.info('Opening browser for authentication...');
  if (options.endpointOverride) {
    logger.warn(`Using endpoint override: ${options.endpointOverride}`);
  }
  logger.verbose('Starting local callback server...');

  const { server, port, dataPromise } = await startCallbackServer();

  try {
    const callbackUrl = `http://localhost:${port}${CALLBACK_PATH}`;
    const authUrl = `${baseUrl}${AUTH_PATH}?callback=${encodeURIComponent(callbackUrl)}`;

    logger.verbose(`Auth URL: ${authUrl}`);
    logger.verbose(`Callback URL: ${callbackUrl}`);

    // Open the browser
    await open(authUrl);

    logger.info('Waiting for authentication...');
    logger.verbose('Complete the authentication in your browser.');

    // Wait for the callback with timeout
    const data = await Promise.race([
      dataPromise,
      timeout(AUTH_TIMEOUT_MS),
    ]);

    if (!data) {
      throw new AuthenticationError('Authentication timed out. Please try again.');
    }

    if (data.error) {
      throw new AuthenticationError(data.error);
    }

    if (!data.orgSlug) {
      throw new AuthenticationError('No organization selected. Please try again.');
    }

    logger.success(`Authenticated with organization: ${data.orgSlug}`);

    return {
      orgSlug: data.orgSlug,
    };
  } finally {
    // Always close the server
    await closeServer(server);
  }
}

/**
 * Start a local Express server to receive the callback
 */
async function startCallbackServer(): Promise<{
  server: Server;
  port: number;
  dataPromise: Promise<CallbackData>;
}> {
  const app = express();

  let resolveData: (data: CallbackData) => void;
  const dataPromise = new Promise<CallbackData>((resolve) => {
    resolveData = resolve;
  });

  // Callback endpoint
  app.get(CALLBACK_PATH, (req, res) => {
    const { org_slug, error } = req.query;

    if (error) {
      res.send(errorPage(String(error)));
      resolveData({ error: String(error) });
      return;
    }

    if (!org_slug || typeof org_slug !== 'string') {
      res.send(errorPage('No organization was selected'));
      resolveData({ error: 'No organization was selected' });
      return;
    }

    res.send(successPage(org_slug));
    resolveData({ orgSlug: org_slug });
  });

  // Start server on a random available port
  return new Promise((resolve, reject) => {
    const server = createServer(app);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const port = address.port;
      logger.verbose(`Callback server listening on port ${port}`);

      resolve({ server, port, dataPromise });
    });

    server.on('error', reject);
  });
}

/**
 * Close the callback server
 */
async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      logger.verbose('Callback server closed');
      resolve();
    });
  });
}

/**
 * Timeout helper
 */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new AuthenticationError('Authentication timed out'));
    }, ms);
  });
}

/**
 * Success page HTML
 */
function successPage(orgSlug: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>DevRamps - Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .checkmark {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.5rem 0;
    }
    p {
      opacity: 0.9;
    }
    .org {
      background: rgba(255,255,255,0.2);
      padding: 0.5rem 1rem;
      border-radius: 4px;
      display: inline-block;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p>You can close this window and return to your terminal.</p>
    <div class="org">Organization: ${orgSlug}</div>
  </div>
</body>
</html>
`;
}

/**
 * Error page HTML
 */
function errorPage(error: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>DevRamps - Authentication Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.5rem 0;
    }
    p {
      opacity: 0.9;
    }
    .error {
      background: rgba(255,255,255,0.2);
      padding: 0.5rem 1rem;
      border-radius: 4px;
      display: inline-block;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10007;</div>
    <h1>Authentication Failed</h1>
    <p>Please close this window and try again in your terminal.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>
`;
}
