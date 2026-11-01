import { generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * Generate an ephemeral signing key for the local OIDC provider.
 *
 * The key is scoped to one E2E server process and must never be reused outside tests.
 */
export const createTestOidcJwks = (): string => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = privateKey.export({ format: 'jwk' });

  return JSON.stringify({
    keys: [
      {
        ...jwk,
        alg: 'RS256',
        kid: randomBytes(8).toString('hex'),
        use: 'sig',
      },
    ],
  });
};
