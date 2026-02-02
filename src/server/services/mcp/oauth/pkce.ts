import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 * RFC 7636.
 */
export function generatePKCE(): { codeChallenge: string; codeVerifier: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeChallenge, codeVerifier };
}
