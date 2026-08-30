import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrepareProviderBindingContext } from '../types';
import { kimiCodeDriver } from './kimiCode';

const { closeMock, closeSyncMock, startProviderBindingProxyMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  closeSyncMock: vi.fn(),
  startProviderBindingProxyMock: vi.fn(),
}));

vi.mock('../providerBindingProxy', () => ({
  startProviderBindingProxy: startProviderBindingProxyMock,
}));

const bindingContext = (
  protocol: PrepareProviderBindingContext['resolution']['protocol'],
  endpoint: string | undefined = 'https://gateway.example.com/v1',
): PrepareProviderBindingContext => ({
  args: [
    '--model',
    'stale-model',
    '-mshort-stale-model',
    '-S',
    'short-stale-session',
    '--resume=other-stale-session',
    '--session=stale-session',
    '--session',
    '--verbose',
    '--model=other-stale-model',
    '--continue',
    '-c',
    '-C',
  ],
  env: {
    KEEP_ME: 'yes',
    KIMI_CODE_HOME: '/user/kimi',
    KIMI_MODEL_API_KEY: 'stale-key',
    KIMI_MODEL_BASE_URL: 'https://stale.example.com',
    KIMI_MODEL_NAME: 'stale-model',
    KIMI_MODEL_PROVIDER_TYPE: 'kimi',
  },
  profileDir: '/managed/kimi',
  reference: {
    apiConfig: { model: 'bound-model', providerId: 'provider-test' },
    kind: 'provider',
  },
  resolution: {
    agentType: 'kimi-code',
    apiConfig: { model: 'bound-model', providerId: 'provider-test' },
    endpoint,
    protocol,
    providerId: 'provider-test',
    runtimeConfig: {
      config: {},
      keyVaults: {
        apiKey: ' bound-key ',
        ...(endpoint ? { baseURL: endpoint } : {}),
      },
      settings: { sdkType: protocol === 'anthropic-messages' ? 'anthropic' : 'openai' },
    },
  },
  runDir: '/managed/run',
});

describe('kimiCodeDriver', () => {
  beforeEach(() => {
    closeMock.mockReset();
    closeSyncMock.mockReset();
    startProviderBindingProxyMock.mockReset();
    startProviderBindingProxyMock.mockImplementation(async ({ protocol }) => ({
      clientApiKey: 'proxy-client-key',
      close: closeMock,
      closeSync: closeSyncMock,
      endpoint:
        protocol === 'anthropic-messages' ? 'http://127.0.0.1:4321' : 'http://127.0.0.1:4321/v1',
    }));
  });

  it('prepares the server-default Anthropic binding without persisting its operation token', async () => {
    const plan = await kimiCodeDriver.prepareServerDefaultBinding!({
      args: ['--model', 'stale-model', '--verbose'],
      endpoint: 'https://app.example.com',
      env: { KEEP_ME: 'yes', KIMI_MODEL_API_KEY: 'stale-token' },
      model: 'kimi-k2.6',
      profileDir: '/managed/kimi',
    });

    expect(plan).toMatchObject({
      args: ['--verbose'],
      env: {
        KEEP_ME: 'yes',
        KIMI_CODE_HOME: '/managed/kimi',
        KIMI_MODEL_BASE_URL: 'https://app.example.com/api/v1/anthropic',
        KIMI_MODEL_NAME: 'lobehub/kimi-k2.6',
        KIMI_MODEL_PROVIDER_TYPE: 'anthropic',
      },
      operationTokenEnvKey: 'KIMI_MODEL_API_KEY',
    });
    expect(plan.env.KIMI_MODEL_API_KEY).toBeUndefined();
  });

  it('builds exact fresh and resumed one-shot plans', async () => {
    const buildAgentInput = vi.fn().mockResolvedValue({ args: ['--prompt', 'secret'], stdin: '' });
    const base = {
      args: ['--model', 'kimi-for-coding'],
      helpers: { buildAgentInput },
      promptInput: 'secret',
    } as any;

    await expect(kimiCodeDriver.buildSpawnPlan(base)).resolves.toEqual({
      args: ['--output-format', 'stream-json', '--model', 'kimi-for-coding', '--prompt', 'secret'],
      stdinPayload: '',
    });
    await expect(
      kimiCodeDriver.buildSpawnPlan({ ...base, resumeSessionId: 'session-1' }),
    ).resolves.toEqual({
      args: [
        '--output-format',
        'stream-json',
        '--session',
        'session-1',
        '--model',
        'kimi-for-coding',
        '--prompt',
        'secret',
      ],
      stdinPayload: '',
    });
    expect(buildAgentInput).toHaveBeenCalledWith('kimi-code', 'secret');
  });

  it.each([
    ['openai-chat-completions', 'openai', 'http://127.0.0.1:4321/v1'],
    ['anthropic-messages', 'anthropic', 'http://127.0.0.1:4321'],
  ] as const)(
    'injects a secret-free proxy binding for %s',
    async (protocol, providerType, proxyEndpoint) => {
      const plan = await kimiCodeDriver.prepareProviderBinding!(bindingContext(protocol));
      const { env, ...nonEnvironmentPlan } = plan;

      expect(plan.args).toEqual(['--verbose']);
      expect(env).toEqual({
        KEEP_ME: 'yes',
        KIMI_CODE_HOME: '/managed/kimi',
        KIMI_MODEL_API_KEY: 'proxy-client-key',
        KIMI_MODEL_BASE_URL: proxyEndpoint,
        KIMI_MODEL_NAME: 'bound-model',
        KIMI_MODEL_PROVIDER_TYPE: providerType,
      });
      expect(startProviderBindingProxyMock).toHaveBeenCalledWith({
        apiKey: 'bound-key',
        endpoint: 'https://gateway.example.com/v1',
        protocol,
      });
      expect(plan.cleanup).toBe(closeMock);
      expect(plan.cleanupSync).toBe(closeSyncMock);
      expect(plan.profileFiles).toBeUndefined();
      expect(plan.runFiles).toBeUndefined();
      expect(JSON.stringify(nonEnvironmentPlan)).not.toContain('bound-key');
      expect(JSON.stringify(env)).not.toContain('bound-key');
    },
  );

  it('overrides inherited base URLs with the local proxy for official providers', async () => {
    const context = bindingContext('openai-chat-completions');
    context.reference.apiConfig.providerId = 'openai';
    context.resolution.apiConfig.providerId = 'openai';
    context.resolution.endpoint = undefined;
    context.resolution.providerId = 'openai';
    delete context.resolution.runtimeConfig.keyVaults.baseURL;
    const plan = await kimiCodeDriver.prepareProviderBinding!(context);

    expect(startProviderBindingProxyMock).toHaveBeenCalledWith({
      apiKey: 'bound-key',
      endpoint: undefined,
      protocol: 'openai-chat-completions',
    });
    expect(plan.env.KIMI_MODEL_BASE_URL).toBe('http://127.0.0.1:4321/v1');
    expect(plan.env.KIMI_MODEL_PROVIDER_TYPE).toBe('openai');
  });

  it.each(['openai-responses', 'google-generative-ai'] as const)(
    'rejects unsupported %s bindings instead of writing provider config',
    async (protocol) => {
      await expect(
        kimiCodeDriver.prepareProviderBinding!(bindingContext(protocol)),
      ).rejects.toThrow(`Kimi Code cannot use ${protocol}.`);
      expect(startProviderBindingProxyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty provider API key', async () => {
    const context = bindingContext('anthropic-messages');
    context.resolution.runtimeConfig.keyVaults.apiKey = '  ';

    await expect(kimiCodeDriver.prepareProviderBinding!(context)).rejects.toThrow(
      'Kimi Code provider binding requires an API key.',
    );
    expect(startProviderBindingProxyMock).not.toHaveBeenCalled();
  });
});
