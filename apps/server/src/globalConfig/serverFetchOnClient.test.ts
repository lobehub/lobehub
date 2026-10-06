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

  it('leaves other providers on their own default', () => {
    expect(getServerFetchOnClientOverride('lmstudio')).toBeUndefined();
    expect(getServerFetchOnClientOverride('openai')).toBeUndefined();
  });
});
