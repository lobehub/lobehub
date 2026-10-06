import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

const { writeCommandEnv } = vi.hoisted(() => ({ writeCommandEnv: vi.fn() }));

vi.mock('../providers/onlyboxes', () => ({
  OnlyboxesSandboxProvider: vi.fn().mockImplementation(function () {
    return { writeCommandEnv };
  }),
}));

const creds = [
  { id: 1, key: 'github-pat', type: 'kv-env' },
  { id: 2, key: 'github', type: 'oauth' },
  { id: 3, key: 'api-header', type: 'kv-header' },
  { id: 4, key: 'gcp', type: 'file' },
  { id: 5, key: 'openai', type: 'kv-env' },
];

const plaintexts: Record<number, Record<string, string>> = {
  1: { GITHUB_TOKEN: 'ghp_abcdefghijklmnop' },
  5: { 'not a name': 'x', 'OPENAI_API_KEY': 'sk-1234567890', 'OPENAI_BASE_URL': '' },
};

const setup = async (provider?: 'market' | 'onlyboxes') => {
  vi.doMock('@/envs/sandbox', () => ({
    sandboxEnv: provider ? { SANDBOX_PROVIDER: provider } : {},
  }));

  const inject = vi.fn().mockResolvedValue({ fromMarket: true });
  const credsAccessor = {
    get: vi.fn(async (id: number) => ({ plaintext: plaintexts[id] })),
    list: vi.fn(async () => ({ data: creds })),
  };
  const marketService = { market: { creds: { inject } } } as unknown as MarketService;
  const { injectSandboxCreds } = await import('../credentials');

  return {
    credsAccessor,
    getCredsAccessor: () => credsAccessor,
    inject,
    injectSandboxCreds,
    marketService,
  };
};

const target = { topicId: 'topic-1', userId: 'user-1' };

describe('injectSandboxCreds', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    writeCommandEnv.mockResolvedValue(undefined);
  });

  it("leaves injection to Market's own sandbox by default", async () => {
    const { credsAccessor, getCredsAccessor, inject, injectSandboxCreds, marketService } =
      await setup();

    const result = await injectSandboxCreds({
      getCredsAccessor,
      keys: ['github'],
      marketService,
      sandbox: true,
      ...target,
    });

    expect(result).toEqual({ fromMarket: true });
    expect(inject).toHaveBeenCalledWith({ keys: ['github'], sandbox: true, ...target });
    expect(credsAccessor.list).not.toHaveBeenCalled();
    expect(writeCommandEnv).not.toHaveBeenCalled();
  });

  it('asks Market for a non-sandbox injection even on Onlyboxes', async () => {
    const { credsAccessor, getCredsAccessor, inject, injectSandboxCreds, marketService } =
      await setup('onlyboxes');

    await injectSandboxCreds({
      getCredsAccessor,
      keys: ['openai'],
      marketService,
      sandbox: false,
      ...target,
    });

    expect(inject).toHaveBeenCalledWith({ keys: ['openai'], sandbox: false, ...target });
    expect(credsAccessor.list).not.toHaveBeenCalled();
    expect(writeCommandEnv).not.toHaveBeenCalled();
  });

  it('writes decrypted kv-env values into the Onlyboxes session', async () => {
    const { credsAccessor, getCredsAccessor, inject, injectSandboxCreds, marketService } =
      await setup('onlyboxes');

    const result = await injectSandboxCreds({
      getCredsAccessor,
      keys: ['github-pat', 'openai'],
      marketService,
      ...target,
    });

    expect(inject).not.toHaveBeenCalled();
    expect(credsAccessor.get).toHaveBeenCalledWith(1, { decrypt: true });
    expect(credsAccessor.get).toHaveBeenCalledWith(5, { decrypt: true });
    expect(writeCommandEnv).toHaveBeenCalledWith({
      GITHUB_TOKEN: 'ghp_abcdefghijklmnop',
      OPENAI_API_KEY: 'sk-1234567890',
    });
    expect(result).toEqual({
      credentials: {
        env: { GITHUB_TOKEN: 'gh******op', OPENAI_API_KEY: 'sk******90' },
        files: [],
        headers: {},
      },
      notFound: [],
      success: true,
      unsupportedInSandbox: [],
    });
  });

  it('reports credentials that cannot reach the Onlyboxes session instead of injecting them', async () => {
    const { credsAccessor, getCredsAccessor, injectSandboxCreds, marketService } =
      await setup('onlyboxes');

    const result = await injectSandboxCreds({
      getCredsAccessor,
      keys: ['github', 'api-header', 'gcp', 'missing'],
      marketService,
      ...target,
    });

    expect(credsAccessor.get).not.toHaveBeenCalled();
    expect(writeCommandEnv).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      credentials: { env: {} },
      notFound: ['missing'],
      success: false,
      unsupportedInSandbox: ['github', 'api-header', 'gcp'],
    });
  });

  it('fails the injection when the session cannot be written', async () => {
    const { getCredsAccessor, injectSandboxCreds, marketService } = await setup('onlyboxes');
    writeCommandEnv.mockRejectedValue(new Error('Onlyboxes request failed with HTTP 502'));

    await expect(
      injectSandboxCreds({ getCredsAccessor, keys: ['github-pat'], marketService, ...target }),
    ).rejects.toThrow('HTTP 502');
  });
});
