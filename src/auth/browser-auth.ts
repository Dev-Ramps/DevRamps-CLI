/**
 * Browser-based OAuth 2.0 authentication flow with PKCE for DevRamps
 *
 * Implements RFC 7636 (PKCE) to securely authenticate CLI users:
 * 1. Generate PKCE code_verifier and code_challenge
 * 2. Open browser to /oauth/authorize with PKCE params
 * 3. Receive authorization code via localhost callback
 * 4. Exchange code for access token via POST to /oauth/token
 */

import express from 'express';
import open from 'open';
import { createServer, type Server } from 'node:http';
import { AuthenticationError } from '../utils/errors.js';
import * as logger from '../utils/logger.js';
import { isValidAwsAccountId, isValidAwsRegion } from '../utils/validation.js';
import type { AuthData, TokenResponse, OrganizationResponse, AwsConfigurationResponse } from '../types/config.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';

const DEFAULT_AUTH_BASE_URL = 'https://devramps.com';
const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';
const CLI_CLIENT_ID = 'devramps-cli';
const AUTH_TIMEOUT_MS = 300000; // 5 minutes

interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface AuthOptions {
  endpointOverride?: string;
}

/**
 * Start the browser authentication flow using OAuth 2.0 with PKCE
 *
 * 1. Generates PKCE code_verifier/code_challenge and state
 * 2. Opens browser to /oauth/authorize with PKCE params
 * 3. Receives authorization code via localhost callback
 * 4. Exchanges code for access token via POST to /oauth/token
 * 5. Returns the auth data (org, account, region)
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

  // Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  logger.verbose('Generated PKCE code_challenge and state');

  const { server, port, callbackPromise } = await startCallbackServer(state);

  try {
    const redirectUri = `http://localhost:${port}`;

    // Build authorization URL with OAuth 2.0 PKCE params
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: CLI_CLIENT_ID,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state,
    });
    const authUrl = `${baseUrl}${AUTHORIZE_PATH}?${authParams.toString()}`;

    logger.verbose(`Auth URL: ${authUrl}`);
    logger.verbose(`Redirect URI: ${redirectUri}`);

    // Open the browser
    await open(authUrl);

    logger.info('Waiting for authentication...');
    logger.verbose('Complete the authentication in your browser.');

    // Wait for the callback with timeout
    const callbackResult = await Promise.race([
      callbackPromise,
      timeout(AUTH_TIMEOUT_MS),
    ]);

    if (!callbackResult) {
      throw new AuthenticationError('Authentication timed out. Please try again.');
    }

    if (callbackResult.error) {
      const errorMsg = callbackResult.errorDescription || callbackResult.error;
      throw new AuthenticationError(errorMsg);
    }

    if (!callbackResult.code) {
      throw new AuthenticationError('No authorization code received. Please try again.');
    }

    // State is already verified in callback handler, but double-check
    if (callbackResult.state !== state) {
      throw new AuthenticationError('State mismatch - possible CSRF attack. Please try again.');
    }

    logger.verbose('Received authorization code, exchanging for access token...');

    // Exchange authorization code for access token
    const tokenResponse = await exchangeCodeForToken({
      baseUrl,
      code: callbackResult.code,
      redirectUri,
      codeVerifier,
    });

    if (!tokenResponse.organization_id) {
      throw new AuthenticationError('No organization ID in token response. Please try again.');
    }

    logger.verbose('Fetching organization details...');

    // Fetch organization details to get the slug
    const orgResponse = await fetchOrganization({
      baseUrl,
      accessToken: tokenResponse.access_token,
      organizationId: tokenResponse.organization_id,
    });

    // Fetch AWS configuration to get CI/CD account and region
    const awsConfig = await fetchAwsConfiguration({
      baseUrl,
      accessToken: tokenResponse.access_token,
      organizationId: tokenResponse.organization_id,
    });

    // Get CI/CD account ID - can be in cicdAccountId directly or nested in cicdAccount.accountId
    const cicdAccountId = awsConfig.cicdAccountId || awsConfig.cicdAccount?.accountId;

    // Validate AWS configuration
    if (!cicdAccountId) {
      throw new AuthenticationError('No CI/CD account configured for this organization. Please configure one in the DevRamps dashboard.');
    }

    if (!isValidAwsAccountId(cicdAccountId)) {
      throw new AuthenticationError('Invalid CI/CD account ID format.');
    }

    if (!awsConfig.defaultRegion || !isValidAwsRegion(awsConfig.defaultRegion)) {
      throw new AuthenticationError('Invalid or missing default AWS region.');
    }

    logger.success(`Authenticated with organization: ${orgResponse.slug}`);
    logger.verbose(`CI/CD Account: ${cicdAccountId}, Region: ${awsConfig.defaultRegion}`);

    return {
      orgSlug: orgResponse.slug,
      cicdAccountId: cicdAccountId,
      cicdRegion: awsConfig.defaultRegion,
    };
  } finally {
    // Always close the server
    await closeServer(server);
  }
}

/**
 * Exchange authorization code for access token via POST to /oauth/token
 */
async function exchangeCodeForToken(params: {
  baseUrl: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const tokenUrl = `${params.baseUrl}${TOKEN_PATH}`;

  // Build form-encoded body per OAuth 2.0 spec
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLI_CLIENT_ID,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  logger.verbose(`Token exchange URL: ${tokenUrl}`);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    let errorMessage = `Token exchange failed with status ${response.status}`;
    try {
      const errorBody = await response.json() as { error?: string; error_description?: string };
      if (errorBody.error_description) {
        errorMessage = errorBody.error_description;
      } else if (errorBody.error) {
        errorMessage = `Token exchange failed: ${errorBody.error}`;
      }
    } catch {
      // Ignore JSON parse errors, use default message
    }
    throw new AuthenticationError(errorMessage);
  }

  const tokenResponse = await response.json() as TokenResponse;

  if (!tokenResponse.access_token) {
    throw new AuthenticationError('No access token in response');
  }

  logger.verbose(`Token response: organization_id=${tokenResponse.organization_id}, scope=${tokenResponse.scope}, expires_in=${tokenResponse.expires_in}`);

  return tokenResponse;
}

/**
 * Fetch organization details from the API
 */
async function fetchOrganization(params: {
  baseUrl: string;
  accessToken: string;
  organizationId: string;
}): Promise<OrganizationResponse> {
  const url = `${params.baseUrl}/api/v1/organizations/${params.organizationId}`;

  logger.verbose(`Fetching organization: GET ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  });

  logger.verbose(`Organization response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    logger.verbose(`Organization error response: ${errorText}`);
    throw new AuthenticationError(`Failed to fetch organization: ${response.status}`);
  }

  const data = await response.json() as OrganizationResponse;
  logger.verbose(`Organization data: id=${data.id}, name=${data.name}, slug=${data.slug}`);

  return data;
}

/**
 * Fetch AWS configuration for the organization
 */
async function fetchAwsConfiguration(params: {
  baseUrl: string;
  accessToken: string;
  organizationId: string;
}): Promise<AwsConfigurationResponse> {
  const url = `${params.baseUrl}/api/v1/organizations/${params.organizationId}/aws/configuration`;

  logger.verbose(`Fetching AWS configuration: GET ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  });

  logger.verbose(`AWS configuration response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    logger.verbose(`AWS configuration error response: ${errorText}`);
    throw new AuthenticationError(`Failed to fetch AWS configuration: ${response.status}`);
  }

  const data = await response.json() as AwsConfigurationResponse;
  logger.verbose(`AWS configuration data: defaultRegion=${data.defaultRegion}, cicdAccountId=${data.cicdAccountId}, cicdAccount=${JSON.stringify(data.cicdAccount)}`);

  return data;
}

/**
 * Start a local Express server to receive the OAuth callback
 */
async function startCallbackServer(expectedState: string): Promise<{
  server: Server;
  port: number;
  callbackPromise: Promise<CallbackResult>;
}> {
  const app = express();

  let resolveCallback: (result: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  // Root path callback endpoint (OAuth redirects to /?code=...&state=...)
  app.get('/', (req, res) => {
    const { code, state, error, error_description } = req.query;

    // Handle OAuth error response
    if (error) {
      res.send(errorPage(String(error_description || error)));
      resolveCallback({
        error: String(error),
        errorDescription: error_description ? String(error_description) : undefined,
      });
      return;
    }

    // Validate state to prevent CSRF
    if (!state || state !== expectedState) {
      res.send(errorPage('Invalid state parameter - possible CSRF attack'));
      resolveCallback({ error: 'state_mismatch' });
      return;
    }

    // Validate code is present
    if (!code || typeof code !== 'string') {
      res.send(errorPage('No authorization code received'));
      resolveCallback({ error: 'missing_code' });
      return;
    }

    // Success - show confirmation page
    res.send(successPage());
    resolveCallback({
      code: code,
      state: String(state),
    });
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

      resolve({ server, port, callbackPromise });
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
function successPage(): string {
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
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p>You can close this window and return to your terminal.</p>
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
