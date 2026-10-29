// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getApiKeyHashes, hashApiKey, hashApiKeyWithSecret } from './apiKeyHash';

const activeSecret = 'active-secret';
const fallbackSecret = 'fallback-secret';

describe('API key hashing during secret rotation', () => {
  const originalActive = process.env.KEY_VAULTS_SECRET;
  const originalFallback = process.env.KEY_VAULTS_FALLBACK_SECRET;

  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = activeSecret;
    delete process.env.KEY_VAULTS_FALLBACK_SECRET;
  });

  afterEach(() => {
    if (originalActive === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = originalActive;
    if (originalFallback === undefined) delete process.env.KEY_VAULTS_FALLBACK_SECRET;
    else process.env.KEY_VAULTS_FALLBACK_SECRET = originalFallback;
  });

  it('returns only the active hash when no fallback is configured', () => {
    expect(getApiKeyHashes('lobe-test')).toEqual([hashApiKey('lobe-test')]);
  });

  it('returns active then fallback hashes without duplicates', () => {
    process.env.KEY_VAULTS_FALLBACK_SECRET = fallbackSecret;

    expect(getApiKeyHashes('lobe-test')).toEqual([
      hashApiKeyWithSecret('lobe-test', activeSecret),
      hashApiKeyWithSecret('lobe-test', fallbackSecret),
    ]);

    process.env.KEY_VAULTS_FALLBACK_SECRET = activeSecret;
    expect(getApiKeyHashes('lobe-test')).toHaveLength(1);
  });
});
