import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeGitHubAppPrivateKey, getScmConfig } from '../scm';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';

describe('decodeGitHubAppPrivateKey', () => {
  it('passes a raw PEM through', () => {
    expect(decodeGitHubAppPrivateKey(`  ${PEM}\n`)).toBe(PEM);
  });

  it('decodes a base64-wrapped PEM', () => {
    expect(decodeGitHubAppPrivateKey(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('rejects values that decode to something other than a PEM', () => {
    expect(decodeGitHubAppPrivateKey(Buffer.from('not a key').toString('base64'))).toBeUndefined();
    expect(decodeGitHubAppPrivateKey('')).toBeUndefined();
    expect(decodeGitHubAppPrivateKey(undefined)).toBeUndefined();
  });
});

describe('getScmConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled until every install-flow value is present', () => {
    vi.stubEnv('GITHUB_APP_ID', '1');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', PEM);
    vi.stubEnv('GITHUB_APP_WEBHOOK_SECRET', 's');
    vi.stubEnv('GITHUB_APP_SLUG', '');
    expect(getScmConfig().ENABLED_GITHUB_APP).toBe(false);

    vi.stubEnv('GITHUB_APP_SLUG', 'lobehub');
    const env = getScmConfig();
    expect(env.ENABLED_GITHUB_APP).toBe(true);
    expect(env.GITHUB_APP_PRIVATE_KEY).toBe(PEM);
  });
});
