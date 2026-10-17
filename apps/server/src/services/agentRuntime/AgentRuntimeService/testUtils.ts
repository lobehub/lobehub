/**
 * Shared fixtures for the AgentRuntimeService scenario tests: the module mock
 * factories (each test file keeps its own `vi.mock` calls and points them
 * here) and the per-test service setup.
 */
import type { UIChatMessage } from '@lobechat/types';
import type * as ModelBankModule from 'model-bank';
import { vi } from 'vitest';

import type { AgentRuntimeService } from '.';

/** The `importOriginal` a `vi.mock` factory receives. */
type ImportOriginal = <T = unknown>() => Promise<T>;

export const lobechatModelRuntimeModule = () => ({
  // RuntimeExecutors (loaded transitively) resolves extend params via this
  // helper; an empty result keeps the runtime payload unchanged.
  applyModelExtendParams: vi.fn(function () {
    return {};
  }),
  getModelPropertyWithFallback: vi.fn(),
  // `llmErrorClassification.ts` reads these at module-load time; an empty
  // spec map is fine here because this suite never exercises the runtime
  // retry classifier path.
  ERROR_CODE_SPECS: {},
  getErrorCodeSpec: () => undefined,
  refineErrorCode: () => undefined,
});

// Mock trusted client to avoid server-side env access
export const libsTrustedClientModule = () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
});

// Mock database and models
export const serverServicesFileModule = () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      getFullFileUrl: vi.fn(async (path: string) => `model:${path}`),
      getFileAccessUrl: vi.fn(async (file: { id: string }) => `ui:${file.id}`),
    };
  }),
});

export const databaseModelsMessageModule = () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockResolvedValue(undefined),
      findMessagePlugin: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
    };
  }),
});

export const databaseModelsAgentModule = () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfigById: vi.fn(),
    };
  }),
});

export const databaseModelsPluginModule = () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
});

// Mock ModelRuntime to avoid server-side env access
export const serverModulesModelRuntimeModule = () => ({
  initializeRuntimeOptions: vi.fn(),
  ApiKeyManager: vi.fn().mockImplementation(function () {
    return {
      getApiKey: vi.fn(),
      getAllApiKeys: vi.fn(),
    };
  }),
});

// Mock search service to avoid server-side env access
export const serverServicesSearchModule = () => ({
  SearchService: vi.fn().mockImplementation(function () {
    return {
      search: vi.fn(),
    };
  }),
  searchService: {
    search: vi.fn(),
  },
});

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
export const serverModulesAgentRuntimeFactoryModule = async () => {
  const { InMemoryAgentStateManager } =
    await import('@/server/modules/AgentRuntime/InMemoryAgentStateManager');
  const { InMemoryStreamEventManager } =
    await import('@/server/modules/AgentRuntime/InMemoryStreamEventManager');
  return {
    createAgentStateManager: () => new InMemoryAgentStateManager(),
    createStreamEventManager: () => new InMemoryStreamEventManager(),
    isRedisAvailable: () => false,
  };
};

export const serverModulesAgentRuntimeRedisModule = () => ({
  createAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
});

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
export const serverModulesAgentRuntimeModule = async (importOriginal: ImportOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createRuntimeExecutors: vi.fn(),
  };
};

// Spread the real module and override only `AgentRuntime` (to stub `.step()`).
// Keeps the real status predicates + package-hosted executors (e.g. `finish`),
// so this mock survives future executor migrations without edits.
export const lobechatAgentRuntimeModule = async (importOriginal: ImportOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  AgentRuntime: vi.fn().mockImplementation(function (_agent, _options) {
    return {
      step: vi.fn(),
    };
  }),
});

export const serverServicesQueueModule = () => ({
  QueueService: vi.fn().mockImplementation(function () {
    return {
      getImpl: vi.fn().mockReturnValue(null),
      scheduleMessage: vi.fn(),
    };
  }),
});

// Mock Mecha module
export const serverModulesMechaModule = () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({
      tools: [],
      enabledToolIds: [],
      filteredTools: [],
    }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([]),
});

// Mock model-bank
export const modelBankModule = async (importOriginal: ImportOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        abilities: {
          functionCall: true,
          vision: true,
          video: false,
        },
      },
    ],
  };
};

export const buildPersistedToolChain = (
  finalContent: string,
  finalMetadata?: Record<string, unknown>,
): UIChatMessage[] => [
  {
    content: 'question',
    createdAt: 1,
    id: 'user-1',
    role: 'user',
    updatedAt: 1,
  },
  {
    content: '',
    createdAt: 2,
    id: 'assistant-tools',
    parentId: 'user-1',
    role: 'assistant',
    tools: [
      {
        apiName: 'command_execution',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'codex',
        result_msg_id: 'tool-result-1',
        type: 'default',
      },
    ],
    updatedAt: 2,
  },
  {
    content: 'tool result',
    createdAt: 3,
    id: 'tool-result-1',
    parentId: 'assistant-tools',
    role: 'tool',
    tool_call_id: 'tool-call-1',
    updatedAt: 3,
  },
  {
    content: finalContent,
    createdAt: 4,
    id: 'assistant-final',
    metadata: finalMetadata,
    parentId: 'tool-result-1',
    role: 'assistant',
    updatedAt: 4,
  },
];

export interface ServiceTestContext {
  mockCoordinator: any;
  mockDb: any;
  mockQueueService: any;
  mockStreamManager: any;
  service: AgentRuntimeService;
}

/**
 * Build a service backed by the in-memory coordinator and stream manager, with
 * every coordinator and stream-manager method spied. Takes the class so this
 * module stays type-only towards it (the mock factories above load first).
 */
export const setUpService = (
  Service: typeof AgentRuntimeService,
  mockUserId: string,
): ServiceTestContext => {
  vi.clearAllMocks();
  process.env.AGENT_RUNTIME_BASE_URL = 'http://localhost:3010';

  // Mock database
  const mockDb: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const service = new Service(mockDb, mockUserId);

  // Get real instances (backed by InMemory implementations)
  const mockCoordinator = (service as any).coordinator;
  const mockStreamManager = (service as any).streamManager;
  const mockQueueService = (service as any).queueService;

  // Auto-spy all coordinator methods so tests can use .mockResolvedValue() / .toHaveBeenCalledWith()
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(mockCoordinator))) {
    if (key !== 'constructor' && typeof mockCoordinator[key] === 'function') {
      vi.spyOn(mockCoordinator, key);
    }
  }
  // Auto-spy all streamManager methods
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(mockStreamManager))) {
    if (key !== 'constructor' && typeof mockStreamManager[key] === 'function') {
      vi.spyOn(mockStreamManager, key);
    }
  }

  return { mockCoordinator, mockDb, mockQueueService, mockStreamManager, service };
};
