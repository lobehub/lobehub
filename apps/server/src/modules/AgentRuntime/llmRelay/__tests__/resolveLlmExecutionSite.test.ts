// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { resolveLlmExecutionSite } from '../resolveLlmExecutionSite';

const providerRow = vi.hoisted(() => ({ current: undefined as any }));
const getAiProviderById = vi.hoisted(() => vi.fn(async () => providerRow.current));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn(function (this: any) {
    this.getAiProviderById = getAiProviderById;
  }),
}));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  resolveRuntimeProvider: (provider: string, sdkType?: string) =>
    ['ollama', 'lmstudio', 'openai'].includes(provider) ? provider : sdkType || 'openai',
}));
const executor = (providers: string[]) => ({
  host: {
    llmExecutor: { capabilities: ['llm_relay@1'], clientId: 'tab-a', providers },
  },
});

const resolve = (provider: string, state?: any) =>
  resolveLlmExecutionSite({ db: {} as any, provider, state, userId: 'user-1' });

describe('resolveLlmExecutionSite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerRow.current = { fetchOnClient: undefined, keyVaults: {} };
    vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig).mockResolvedValue({
      enableLlmRelay: true,
    } as any);
  });

  it('keeps every call on the server while the relay is off for the user', async () => {
    vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig).mockResolvedValue({
      enableLlmRelay: false,
    } as any);

    expect(await resolve('ollama', executor(['ollama']))).toEqual({ site: 'server' });
    expect(getAiProviderById).not.toHaveBeenCalled();
  });

  it('never relays the platform provider or a shared-agent visitor run', async () => {
    expect(await resolve('lobehub', executor(['lobehub']))).toEqual({ site: 'server' });
    expect(
      await resolve('ollama', {
        ...executor(['ollama']),
        principal: { actor: { shareVisitor: { visitorUserId: 'v' } } },
      }),
    ).toEqual({ site: 'server' });
  });

  it('relays Ollama (fetchOnClient by default) to the client that declared it', async () => {
    expect(await resolve('ollama', executor(['ollama']))).toEqual({
      preferredClientId: 'tab-a',
      runtimeProvider: 'ollama',
      site: 'client',
    });
  });

  it('relays an inherited executor on the channel its client subscribed to', async () => {
    const inherited = executor(['ollama']);
    (inherited.host.llmExecutor as any).channelOperationId = 'parent-op';

    expect(await resolve('ollama', inherited)).toEqual({
      channelOperationId: 'parent-op',
      preferredClientId: 'tab-a',
      runtimeProvider: 'ollama',
      site: 'client',
    });
  });

  it('reports unavailable when no client declared it can run the provider', async () => {
    expect(await resolve('ollama')).toEqual({ reason: 'no_executor', site: 'unavailable' });
    expect(await resolve('ollama', executor(['lmstudio']))).toEqual({
      reason: 'no_executor',
      site: 'unavailable',
    });
    expect(
      await resolve('ollama', {
        host: {
          llmExecutor: { capabilities: ['llm_relay@9'], clientId: 'tab-a', providers: ['ollama'] },
        },
      }),
    ).toEqual({ reason: 'no_executor', site: 'unavailable' });
  });

  it('follows an explicit fetchOnClient: false for a provider that defaults to the client', async () => {
    providerRow.current = { fetchOnClient: false, keyVaults: {} };
    expect(await resolve('ollama', executor(['ollama']))).toEqual({ site: 'server' });
  });

  it('keeps Ollama on the server when the deployment proxies it (OLLAMA_PROXY_URL)', async () => {
    vi.stubEnv('OLLAMA_PROXY_URL', 'http://ollama.internal:11434');
    try {
      expect(await resolve('ollama', executor(['ollama']))).toEqual({ site: 'server' });

      providerRow.current = { fetchOnClient: true, keyVaults: {} };
      expect(await resolve('ollama', executor(['ollama']))).toMatchObject({ site: 'client' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('relays a custom provider with client requests enabled, with its sdkType', async () => {
    providerRow.current = {
      fetchOnClient: true,
      keyVaults: { apiKey: 'sk-local', baseURL: 'http://127.0.0.1:1234/v1' },
      settings: { sdkType: 'openai' },
    };

    expect(await resolve('my-local-llm', executor(['my-local-llm']))).toEqual({
      preferredClientId: 'tab-a',
      runtimeProvider: 'openai',
      site: 'client',
    });
  });

  it('keeps a provider without client requests on the server', async () => {
    providerRow.current = {
      fetchOnClient: false,
      keyVaults: { apiKey: 'sk-local', baseURL: 'http://127.0.0.1:1234/v1' },
    };

    expect(await resolve('my-local-llm', executor(['my-local-llm']))).toEqual({ site: 'server' });
  });

  // The client store sends a provider with only a base URL from the device
  // whatever `fetchOnClient` says; the server must relay it the same way, or the
  // client prepares no executor and the call fails as `no_executor`.
  it('relays a provider with only a base URL, like the client store does', async () => {
    providerRow.current = {
      fetchOnClient: false,
      keyVaults: { baseURL: 'http://127.0.0.1:1234/v1' },
    };

    expect(await resolve('my-local-llm', executor(['my-local-llm']))).toMatchObject({
      site: 'client',
    });
  });

  it('keeps a provider whose card disables browser requests on the server', async () => {
    providerRow.current = { fetchOnClient: true, keyVaults: { baseURL: 'http://127.0.0.1:1/v1' } };

    expect(await resolve('cloudflare', executor(['cloudflare']))).toEqual({ site: 'server' });
  });
});
