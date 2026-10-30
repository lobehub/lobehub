// @vitest-environment node
import Keygrip from 'keygrip';
import { describe, expect, it, vi } from 'vitest';

import { getOIDCCookieKeys, verifyOIDCCookieSignature } from './cookies';

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    KEY_VAULTS_FALLBACK_SECRET: 'fallback-cookie-key',
    KEY_VAULTS_SECRET: 'active-cookie-key',
  },
}));

describe('OIDC cookie key rotation', () => {
  it('signs with the active key and verifies signatures from the fallback key', () => {
    expect(getOIDCCookieKeys()).toEqual(['active-cookie-key', 'fallback-cookie-key']);
    const signature = new Keygrip(['fallback-cookie-key']).sign('_session=session-1');
    expect(verifyOIDCCookieSignature('_session', 'session-1', signature)).toBe(true);
  });
});
