import { describe, expect, it } from 'vitest';

import {
  apiBearerChallenge,
  AUTHORIZATION_SERVER_METADATA_PATH,
  buildProtectedResourceMetadata,
  PROTECTED_RESOURCE_METADATA_PATH,
} from './discovery-metadata';

const ORIGIN = 'https://app.lobehub.com';

describe('API OAuth discovery metadata', () => {
  it('inserts the well-known prefix before the resource and issuer paths (RFC 9728, RFC 8414)', () => {
    expect(PROTECTED_RESOURCE_METADATA_PATH).toBe('/.well-known/oauth-protected-resource/api/v1');
    expect(AUTHORIZATION_SERVER_METADATA_PATH).toBe('/.well-known/oauth-authorization-server/oidc');
  });

  it('describes /api/v1 with the deployment issuer and header bearer tokens', () => {
    expect(buildProtectedResourceMetadata(ORIGIN, true)).toEqual({
      authorization_servers: ['https://app.lobehub.com/oidc'],
      bearer_methods_supported: ['header'],
      resource: 'https://app.lobehub.com/api/v1',
      resource_documentation: 'https://lobehub.com/docs/development/api/authentication',
      resource_name: 'LobeHub API',
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    });
  });

  it('names no authorization server when OIDC is off (API keys only)', () => {
    const metadata = buildProtectedResourceMetadata('https://chat.example.com/', false);

    expect(metadata).not.toHaveProperty('authorization_servers');
    expect(metadata.resource).toBe('https://chat.example.com/api/v1');
  });

  it('builds the 401 challenge from the metadata URL', () => {
    expect(apiBearerChallenge(ORIGIN)).toBe(
      'Bearer realm="LobeHub API", resource_metadata="https://app.lobehub.com/.well-known/oauth-protected-resource/api/v1"',
    );
  });
});
