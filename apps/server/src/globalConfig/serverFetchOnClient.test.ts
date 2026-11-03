import { isProviderFetchOnClient } from 'model-bank/modelProviders';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getServerFetchOnClientOverride } from './serverFetchOnClient';

describe('getServerFetchOnClientOverride', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends Ollama through the server only when the deployment proxies it', () => {
    expect(getServerFetchOnClientOverride('ollama')).toBe(true);

    vi.stubEnv('OLLAMA_PROXY_URL', 'http://ollama.internal:11434');
    expect(getServerFetchOnClientOverride('ollama')).toBe(false);
  });

  it('turns client fetch on for the other local providers', () => {
    expect(getServerFetchOnClientOverride('lmstudio')).toBe(true);
    expect(getServerFetchOnClientOverride('unsloth')).toBe(true);
  });

  it('sends magpie from the browser unless the deployment reaches another one', () => {
    expect(getServerFetchOnClientOverride('magpie')).toBe(true);

    vi.stubEnv('MAGPIE_PROXY_URL', 'http://magpie.internal:3425');
    expect(getServerFetchOnClientOverride('magpie')).toBe(false);
  });

  // The settings switch shows this default; it must match what the relay does.
  it.each(['magpie', 'ollama', 'lmstudio', 'unsloth'])(
    'shows the same default for %s as the relay applies',
    (provider) => {
      const fetchOnClient = getServerFetchOnClientOverride(provider);

      expect(fetchOnClient).toBe(isProviderFetchOnClient(provider, { fetchOnClient }));
      expect(fetchOnClient).toBe(isProviderFetchOnClient(provider, undefined));
    },
  );

  it('leaves other providers on their own default', () => {
    expect(getServerFetchOnClientOverride('openai')).toBeUndefined();
  });
});
