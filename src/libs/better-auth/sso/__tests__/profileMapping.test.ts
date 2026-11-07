import { describe, expect, it, vi } from 'vitest';

import Casdoor from '../providers/casdoor';
import CloudflareZeroTrust from '../providers/cloudflare-zero-trust';
import GenericOIDC from '../providers/generic-oidc';
import Logto from '../providers/logto';
import Okta from '../providers/okta';

vi.mock('@/envs/auth', () => ({ authEnv: {} }));

const providers = [
  Casdoor.build({
    AUTH_CASDOOR_ID: 'id',
    AUTH_CASDOOR_ISSUER: 'https://issuer.example',
    AUTH_CASDOOR_SECRET: 'secret',
  }),
  CloudflareZeroTrust.build({
    AUTH_CLOUDFLARE_ZERO_TRUST_ID: 'id',
    AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER: 'https://issuer.example',
    AUTH_CLOUDFLARE_ZERO_TRUST_SECRET: 'secret',
  }),
  GenericOIDC.build({
    AUTH_GENERIC_OIDC_ID: 'id',
    AUTH_GENERIC_OIDC_ISSUER: 'https://issuer.example',
    AUTH_GENERIC_OIDC_SECRET: 'secret',
  }),
  Logto.build({
    AUTH_LOGTO_ID: 'id',
    AUTH_LOGTO_ISSUER: 'https://issuer.example',
    AUTH_LOGTO_SECRET: 'secret',
  }),
  Okta.build({
    AUTH_OKTA_ID: 'id',
    AUTH_OKTA_ISSUER: 'https://issuer.example',
    AUTH_OKTA_SECRET: 'secret',
  }),
];

describe.each(providers)('$providerId profile mapping', (provider) => {
  it('keeps valid names', async () => {
    expect(
      await provider.mapProfileToUser!({ email: 'user@example.com', name: 'User' }),
    ).toMatchObject({
      name: 'User',
    });
  });

  it('ignores malformed custom claims and normalizes a numeric subject fallback', async () => {
    const mapped = await provider.mapProfileToUser!({
      avatar: {},
      displayName: {},
      email: null,
      firstName: {},
      id: 42,
      lastName: [],
      name: null,
      preferred_username: {},
      sub: 42,
      username: {},
    });

    expect(mapped.name).toBe('42');
    expect(mapped.email).toBeUndefined();
    expect(mapped.image).toBeUndefined();
  });
});
