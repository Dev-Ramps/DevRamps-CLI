/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
 *
 * Implements RFC 7636 for secure authorization code flow in public clients.
 * https://datatracker.ietf.org/doc/html/rfc7636
 */

import { randomBytes, createHash } from 'node:crypto';

/**
 * Characters allowed in code_verifier per RFC 7636 Section 4.1
 * unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
 */
const UNRESERVED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generate a cryptographically random code_verifier
 *
 * Per RFC 7636 Section 4.1:
 * - Must be 43-128 characters
 * - Must use unreserved characters only (A-Z, a-z, 0-9, -, ., _, ~)
 *
 * @returns A 128-character code_verifier string
 */
export function generateCodeVerifier(): string {
  const length = 128; // Use maximum length for maximum entropy
  const bytes = randomBytes(length);
  let verifier = '';

  for (let i = 0; i < length; i++) {
    verifier += UNRESERVED_CHARS[bytes[i] % UNRESERVED_CHARS.length];
  }

  return verifier;
}

/**
 * Generate code_challenge from code_verifier using S256 method
 *
 * Per RFC 7636 Section 4.2:
 * code_challenge = BASE64URL(SHA256(code_verifier))
 *
 * @param verifier - The code_verifier to hash
 * @returns Base64URL-encoded SHA-256 hash (no padding)
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();

  // Base64URL encode: replace + with -, / with _, and remove = padding
  return hash.toString('base64url');
}

/**
 * Generate a random state parameter for CSRF protection
 *
 * The state parameter prevents cross-site request forgery attacks
 * by binding the authorization request to the client session.
 *
 * @returns A 32-character random state string
 */
export function generateState(): string {
  return randomBytes(24).toString('base64url');
}
