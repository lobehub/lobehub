import { describe, expect, it, vi } from 'vitest';

import { MARKET_OIDC_ENDPOINTS } from '@/services/_url';

import { MarketOIDC } from './oidc';

describe('MarketOIDC.buildAuthUrl', () => {
  it('should join market baseUrl with OIDC auth path correctly (no string concat issues)', async () => {
    const client = new MarketOIDC({
      baseUrl: 'https://market.lobehub.com/', // trailing slash on purpose
      clientId: 'lobehub-desktop',
      redirectUri: 'https://market.lobehub.com/lobehub-oidc/callback/desktop',
      scope: 'openid profile email',
    });

    vi.spyOn(client, 'generatePKCEParams').mockResolvedValue({
      codeChallenge: 'code_challenge',
      codeVerifier: 'code_verifier',
      state: 'state_value',
    });

    const url = await client.buildAuthUrl();

    expect(url).toContain('https://market.lobehub.com/lobehub-oidc/auth?');
    expect(url).toContain(`client_id=${encodeURIComponent('lobehub-desktop')}`);
    expect(url).toContain(`redirect_uri=${encodeURIComponent('https://market.lobehub.com/lobehub-oidc/callback/desktop')}`);
    expect(url).toContain(`state=${encodeURIComponent('state_value')}`);
    expect(url).toContain(`code_challenge=${encodeURIComponent('code_challenge')}`);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe('openid profile email');

    // The auth endpoint must be a plain path; it is opened in a real browser.
    expect(MARKET_OIDC_ENDPOINTS.auth).toBe('/lobehub-oidc/auth');
  });
});


