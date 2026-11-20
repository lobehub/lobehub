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
  tenant: undefined as
    | {
        endpoint: { basePath: string; publicUrl: string; version: number };
        slug: string;
        tenantId: string;
      }
    | undefined,
  systemModels: { filesConfig: {}, systemAgent: {} } as Record<string, unknown>,
  connectorPolicy: undefined as
    { allowCustomConnectors: boolean; allowlist: string[]; blocklist: string[] } | undefined,
  genServerAiProvidersConfig: vi.fn(
    async (_specificConfig: Record<string, CapturedProviderConfig>) => ({}),
  ),
}));

vi.mock('@lobechat/database/tenant', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  currentTenantScope: () => mocks.tenant,
}));

interface MockGlobalConfigOptions {
  agentGatewayProtocol?: number;
  agentGatewayUrl?: string;
  appUrl?: string;
  enableAgentGateway?: boolean;
  marketTrustedClient?: boolean;
  toolNameMaxLengthEnv?: string;
}

const mockGlobalConfigDependencies = (
  enableBusinessFeatures: boolean,
  options: MockGlobalConfigOptions = {},
) => {
  vi.doMock('@lobechat/business-const', async (importOriginal) => ({
    ...(await importOriginal<object>()),
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
      ...(options.agentGatewayProtocol === undefined
        ? {}
        : { AGENT_GATEWAY_PROTOCOL: options.agentGatewayProtocol }),
      ...(options.agentGatewayUrl ? { AGENT_GATEWAY_URL: options.agentGatewayUrl } : {}),
      ...(options.appUrl ? { APP_URL: options.appUrl } : {}),
      ...(options.enableAgentGateway === undefined
        ? {}
        : { ENABLE_AGENT_GATEWAY: options.enableAgentGateway }),
      ...(options.marketTrustedClient
        ? { MARKET_TRUSTED_CLIENT_ID: 'test-id', MARKET_TRUSTED_CLIENT_SECRET: 'test-secret' }
        : {}),
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

  vi.doMock('@/envs/langfuse', () => ({
    langfuseEnv: {
      ENABLE_LANGFUSE: false,
    },
  }));

  vi.doMock('@/envs/tools', () => ({
    toolsEnv: { TOOL_NAME_MAX_LENGTH: options.toolNameMaxLengthEnv },
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

  vi.doMock('./loginMethods', () => ({
    getLoginMethods: vi.fn(async () => ({
      emailPassword: true,
      magicLink: false,
      requireEmailVerification: false,
    })),
  }));
  vi.doMock('./systemModels', () => ({
    getServerSystemModels: vi.fn(async () => mocks.systemModels),
  }));

  vi.doMock('./parseMemoryExtractionConfig', () => ({
    getPublicMemoryExtractionConfig: vi.fn(() => ({})),
  }));

  vi.doMock('@/server/services/memory/userMemory/systemAgent', () => ({
    resolveMemoryServiceModelConfig: vi.fn(async () => undefined),
  }));

  vi.doMock('@/server/services/connector/policy', () => ({
    getConnectorPolicy: vi.fn(async () => mocks.connectorPolicy),
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
    mocks.tenant = undefined;
    mocks.connectorPolicy = undefined;
    mocks.systemModels = { filesConfig: {}, systemAgent: {} };
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  it('tells the client to hide custom connector entries only when the tenant policy disables them', async () => {
    await expect(loadServerConfig(true)).resolves.not.toHaveProperty('disableCustomConnectors');

    mocks.connectorPolicy = { allowCustomConnectors: true, allowlist: [], blocklist: ['x'] };
    await expect(loadServerConfig(true)).resolves.not.toHaveProperty('disableCustomConnectors');

    mocks.connectorPolicy = { allowCustomConnectors: false, allowlist: [], blocklist: [] };
    await expect(loadServerConfig(true)).resolves.toMatchObject({
      disableCustomConnectors: true,
    });
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

  it('should declare gateway protocol 2 only where the v2 socket exists', async () => {
    // The business gateway serves `/v2/ws`; `lobehub/lobehub-gateway`, which is
    // what a self-hosted deployment runs, serves only `/ws`.
    await expect(loadServerConfig(true)).resolves.toMatchObject({ agentGatewayProtocol: 2 });
    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({ agentGatewayProtocol: 1 });
  });

  it('should let AGENT_GATEWAY_PROTOCOL correct either guess', async () => {
    await expect(loadServerConfig(false, { agentGatewayProtocol: 2 })).resolves.toMatchObject({
      agentGatewayProtocol: 2,
    });

    await expect(
      loadServerConfig(false, {
        agentGatewayProtocol: 1,
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({ agentGatewayProtocol: 1 });

    // An on-prem business deployment sitting in front of a v1 gateway.
    await expect(loadServerConfig(true, { agentGatewayProtocol: 1 })).resolves.toMatchObject({
      agentGatewayProtocol: 1,
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

  it('should hide the LobeHub Skill connectors in business feature mode even if market trusted-client env vars are set', async () => {
    await expect(loadServerConfig(true, { marketTrustedClient: true })).resolves.toMatchObject({
      enableLobehubSkill: false,
    });
  });

  it('should keep the LobeHub Skill connectors gated by the market trusted-client env vars outside business feature mode', async () => {
    await expect(loadServerConfig(false, { marketTrustedClient: true })).resolves.toMatchObject({
      enableLobehubSkill: true,
    });

    await expect(loadServerConfig(false)).resolves.toMatchObject({
      enableLobehubSkill: false,
    });
  });

  it('should expose DEVICE_GATEWAY_PUBLIC_URL without a device gateway service token', async () => {
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', 'https://device-gateway.example.com');
    vi.stubEnv('DEVICE_GATEWAY_SERVICE_TOKEN', undefined);
    vi.stubEnv('DEVICE_GATEWAY_URL', undefined);

    await expect(loadServerConfig(false)).resolves.toHaveProperty(
      'deviceGatewayUrl',
      'https://device-gateway.example.com',
    );
  });

  it("should expose the issuer on the tenant's active entry, as the provider does", async () => {
    mocks.tenant = {
      endpoint: {
        basePath: '/orgs/acme',
        publicUrl: 'https://chat.example.com/orgs/acme',
        version: 1,
      },
      slug: 'acme',
      tenantId: 'tenant-acme',
    };
    await expect(
      loadServerConfig(false, { appUrl: 'https://chat.example.com/' }),
    ).resolves.toHaveProperty('oidcIssuer', 'https://chat.example.com/orgs/acme/oidc');
  });

  it('should omit the OIDC issuer outside a tenant', async () => {
    await expect(
      loadServerConfig(false, { appUrl: 'https://chat.example.com' }),
    ).resolves.not.toHaveProperty('oidcIssuer');
  });

  it('should expose the resolved system models to the client', async () => {
    const systemAgent = { topic: { model: 'topic-model', provider: 'lobehub' } };
    mocks.systemModels = {
      filesConfig: {},
      multimodalUnderstanding: {
        imageFormats: ['image/jpeg'],
        model: 'vision-model',
        provider: 'lobehub',
      },
      systemAgent,
    };

    const config = await loadServerConfig(true);

    expect(config.systemAgent).toEqual(systemAgent);
    expect(config.enableMultimodalUnderstanding).toBe(true);
    expect(config.multimodalUnderstanding).toEqual({ model: 'vision-model', provider: 'lobehub' });
  });

  it('should turn multimodal understanding off when no model is resolved', async () => {
    const config = await loadServerConfig(true);

    expect(config.enableMultimodalUnderstanding).toBe(false);
    expect(config).not.toHaveProperty('multimodalUnderstanding');
  });

  it('reports internal device gateway configuration independently of its public URL', async () => {
    vi.stubEnv('DEVICE_GATEWAY_URL', undefined);
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', 'https://public-gateway.example.com');
    await expect(loadServerConfig(false)).resolves.toHaveProperty('deviceGatewayConfigured', false);

    vi.stubEnv('DEVICE_GATEWAY_URL', 'https://internal-gateway.example.com');
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', undefined);
    const config = await loadServerConfig(false);
    expect(config.deviceGatewayConfigured).toBe(true);
    expect(config.deviceGatewayUrl).toBeUndefined();
  });

  it('should omit the OIDC issuer when APP_URL is not configured', async () => {
    await expect(loadServerConfig(false)).resolves.not.toHaveProperty('oidcIssuer');
  });

  it("should expose the deployment's own origin from APP_URL", async () => {
    await expect(
      loadServerConfig(false, { appUrl: 'https://app.example.com/' }),
    ).resolves.toHaveProperty('appUrl', 'https://app.example.com');
  });

  it('should omit the app origin when APP_URL is not configured', async () => {
    await expect(loadServerConfig(false)).resolves.not.toHaveProperty('appUrl');
  });
});
