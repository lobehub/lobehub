import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface CapturedProviderConfig {
  enabled?: boolean;
  enabledKey?: string;
  fetchOnClient?: boolean;
  modelListKey?: string;
  withDeploymentName?: boolean;
}

const mocks = vi.hoisted(() => ({
  genServerAiProvidersConfig: vi.fn(
    async (_specificConfig: Record<string, CapturedProviderConfig>) => ({}),
  ),
}));

interface MockGlobalConfigOptions {
  agentGatewayUrl?: string;
  enableAgentGateway?: boolean;
  toolNameMaxLengthEnv?: string;
}

const mockGlobalConfigDependencies = (
  enableBusinessFeatures: boolean,
  options: MockGlobalConfigOptions = {},
) => {
  vi.doMock('@lobechat/business-const', () => ({
    ENABLE_BUSINESS_FEATURES: enableBusinessFeatures,
  }));

  vi.doMock('@/config/composio', () => ({
    composioEnv: {},
  }));

  vi.doMock('@/const/version', () => ({
    isDesktop: false,
  }));

  vi.doMock('@/envs/app', () => ({
    appEnv: {
      ...(options.agentGatewayUrl ? { AGENT_GATEWAY_URL: options.agentGatewayUrl } : {}),
      ...(options.enableAgentGateway === undefined
        ? {}
        : { ENABLE_AGENT_GATEWAY: options.enableAgentGateway }),
    },
    getAppConfig: vi.fn(() => ({
      DEFAULT_AGENT_CONFIG: '',
    })),
  }));

  vi.doMock('@/envs/auth', () => ({
    authEnv: {
      AUTH_DISABLE_EMAIL_PASSWORD: false,
      AUTH_EMAIL_VERIFICATION: false,
      AUTH_ENABLE_MAGIC_LINK: false,
      AUTH_SSO_PROVIDERS: '',
    },
  }));

  vi.doMock('@/envs/file', () => ({
    fileEnv: {},
  }));

  vi.doMock('@/envs/image', () => ({
    imageEnv: {
      AI_IMAGE_DEFAULT_IMAGE_NUM: undefined,
    },
  }));

  vi.doMock('@/envs/knowledge', () => ({
    knowledgeEnv: {
      DEFAULT_FILES_CONFIG: undefined,
    },
  }));

  vi.doMock('@/envs/langfuse', () => ({
    langfuseEnv: {
      ENABLE_LANGFUSE: false,
    },
  }));

  vi.doMock('@/envs/tools', () => ({
    toolsEnv: { TOOL_NAME_MAX_LENGTH: options.toolNameMaxLengthEnv },
  }));

  vi.doMock('@/libs/better-auth/utils/server', () => ({
    parseSSOProviders: vi.fn(() => []),
  }));

  vi.doMock('@/server/globalConfig/parseSystemAgent', () => ({
    parseSystemAgent: vi.fn(() => undefined),
  }));

  vi.doMock('@/utils/object', () => ({
    cleanObject: vi.fn((object) => object),
  }));

  vi.doMock('./genServerAiProviderConfig', () => ({
    genServerAiProvidersConfig: mocks.genServerAiProvidersConfig,
  }));

  vi.doMock('./parseDefaultAgent', () => ({
    parseAgentConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseFilesConfig', () => ({
    parseFilesConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseMemoryExtractionConfig', () => ({
    getPublicMemoryExtractionConfig: vi.fn(() => ({})),
  }));
};

const loadCapturedProviderConfig = async (enableBusinessFeatures: boolean) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures);

  const { getServerGlobalConfig } = await import('./index');
  await getServerGlobalConfig();

  return mocks.genServerAiProvidersConfig.mock.calls[0][0] as Record<
    string,
    CapturedProviderConfig
  >;
};

const loadServerConfig = async (
  enableBusinessFeatures: boolean,
  options?: MockGlobalConfigOptions,
) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures, options);

  const { getServerGlobalConfig } = await import('./index');
  return getServerGlobalConfig();
};

describe('getServerGlobalConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should only enable LobeHub by default in business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(true);

    expect(providerConfig[ModelProvider.LobeHub].enabled).toBe(true);
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(false);
    expect(providerConfig[ModelProvider.Ollama].fetchOnClient).toBe(true);

    for (const provider of Object.values(ModelProvider)) {
      if (provider === ModelProvider.LobeHub) continue;

      expect(providerConfig[provider].enabled).toBe(false);
    }
  });

  it('should keep upstream defaults outside business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(false);

    expect(providerConfig[ModelProvider.LobeHub]).toBeUndefined();
    expect(providerConfig[ModelProvider.OpenAI]).toBeUndefined();
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(true);
  });

  it('should enable gateway mode for business builds', async () => {
    await expect(loadServerConfig(true)).resolves.toMatchObject({
      enableGatewayMode: true,
    });
  });

  it('should enable gateway mode for self-hosted builds only when explicitly enabled with a gateway url', async () => {
    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: true,
    });

    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: false,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: false,
    });

    await expect(loadServerConfig(false, { enableAgentGateway: true })).resolves.toMatchObject({
      enableGatewayMode: false,
    });
  });

  // The client-driven chat path builds tool names in the browser, so `0`
  // (tool-name compression off) only takes effect if the server ships the value
  // with the global config.
  it('should expose TOOL_NAME_MAX_LENGTH to the client, including 0', async () => {
    await expect(loadServerConfig(false, { toolNameMaxLengthEnv: '0' })).resolves.toMatchObject({
      toolNameMaxLength: 0,
    });

    await expect(loadServerConfig(false, { toolNameMaxLengthEnv: '30' })).resolves.toMatchObject({
      toolNameMaxLength: 30,
    });

    await expect(loadServerConfig(false)).resolves.toMatchObject({
      toolNameMaxLength: undefined,
    });
  });

  // The value shipped to the client must be parsed exactly like the resolver
  // parses `process.env` on the server — same env value, same tool names on both
  // sides — and a typo must never take the whole global config down.
  it('should parse TOOL_NAME_MAX_LENGTH like the resolver, falling back instead of throwing', async () => {
    const cases: [string, number | undefined][] = [
      ['64', 64],
      ['1e2', 1], // parseInt semantics, not Number()
      ['2048', 2048], // no upper bound
      [' ', undefined], // not `0`
      ['-5', undefined],
      ['abc', undefined],
      ['', undefined],
    ];

    for (const [raw, expected] of cases) {
      await expect(loadServerConfig(false, { toolNameMaxLengthEnv: raw })).resolves.toMatchObject({
        toolNameMaxLength: expected,
      });
    }
  });
});
