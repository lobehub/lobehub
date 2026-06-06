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

const mockGlobalConfigDependencies = (enableBusinessFeatures: boolean) => {
  vi.doMock('@lobechat/business-const', () => ({
    ENABLE_BUSINESS_FEATURES: enableBusinessFeatures,
  }));

  vi.doMock('@/config/klavis', () => ({
    klavisEnv: {},
  }));

  vi.doMock('@/const/version', () => ({
    isDesktop: false,
  }));

  vi.doMock('@/envs/app', () => ({
    appEnv: {},
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
    toolsEnv: {},
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
});
