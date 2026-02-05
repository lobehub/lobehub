// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantStore } from '@/server/modules/AssistantStore';
import { PluginStore } from '@/server/modules/PluginStore';
import { ModelSorts, PluginSorts, ProviderSorts } from '@/types/discover';

import { DiscoverService } from './index';

// Mock external dependencies
vi.mock('@/server/modules/AssistantStore');
vi.mock('@/server/modules/PluginStore');
vi.mock('@lobehub/market-sdk');
vi.mock('@/utils/toolManifest');
vi.mock('@/locales/resources', () => ({
  normalizeLocale: vi.fn((locale) => {
    if (locale === 'en-US') return 'en';
    return locale || 'en';
  }),
}));

// Mock constants with inline data
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4',
        displayName: 'GPT-4',
        description: 'OpenAI GPT-4 model',
        providerId: 'openai',
        contextWindowTokens: 8192,
        abilities: {
          vision: true,
          functionCall: true,
          files: true,
        },
        pricing: {
          input: 0.03,
          output: 0.06,
        },
        releasedAt: '2023-03-01T00:00:00Z',
      },
      {
        id: 'claude-3-opus',
        displayName: 'Claude 3 Opus',
        description: 'Anthropic Claude 3 Opus model',
        providerId: 'anthropic',
        contextWindowTokens: 200000,
        abilities: {
          vision: true,
          reasoning: true,
        },
        pricing: {
          input: 0.015,
          output: 0.075,
        },
        releasedAt: '2024-02-01T00:00:00Z',
      },
    ],
  };
});

vi.mock('@/config/modelProviders', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    DEFAULT_MODEL_PROVIDER_LIST: [
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'OpenAI provider',
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        description: 'Anthropic provider',
      },
    ],
  };
});

vi.mock('@/const/discover', () => ({
  DEFAULT_DISCOVER_ASSISTANT_ITEM: {},
  DEFAULT_DISCOVER_PLUGIN_ITEM: {},
  DEFAULT_DISCOVER_PROVIDER_ITEM: {},
}));

// Mock data - moved after mocks to avoid hoisting issues
const mockAssistantList = [
  {
    identifier: 'assistant-1',
    title: 'Test Assistant 1',
    description: 'A test assistant',
    author: 'Test Author',
    category: 'productivity',
    createdAt: '2024-01-01T00:00:00Z',
    knowledgeCount: 5,
    pluginCount: 2,
    tokenUsage: 1000,
    tags: ['test', 'assistant'],
  },
  {
    identifier: 'assistant-2',
    title: 'Test Assistant 2',
    description: 'Another test assistant',
    author: 'Test Author 2',
    category: 'productivity', // Changed to same category for related items test
    createdAt: '2024-01-02T00:00:00Z',
    knowledgeCount: 3,
    pluginCount: 1,
    tokenUsage: 500,
    tags: ['test', 'creative'],
  },
  {
    identifier: 'assistant-3',
    title: 'Test Assistant 3',
    description: 'A creative assistant',
    author: 'Test Author 3',
    category: 'creativity', // Keep this for category filtering tests
    createdAt: '2024-01-03T00:00:00Z',
    knowledgeCount: 2,
    pluginCount: 0,
    tokenUsage: 300,
    tags: ['test', 'creative'],
  },
];

const mockMarketAssistantList = [
  {
    identifier: 'market-assistant-1',
    name: 'Market Assistant 1',
    summary: 'First market assistant from new source',
    author: { name: 'Market Author 1', avatar: 'https://example.com/avatar1.png' },
    ownerId: 101,
    category: 'productivity',
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-02-02T00:00:00Z',
    avatar: 'https://example.com/avatar1.png',
    tags: ['market', 'assistant'],
    status: 'published',
    tokenUsage: 256,
    config: {
      systemRole: 'You are a productive assistant.',
      knowledgeBases: [{ id: 'kb-1' }],
      plugins: [{ id: 'plugin-1' }],
    },
  },
  {
    identifier: 'market-assistant-2',
    name: 'Market Assistant 2',
    summary: 'Second market assistant from new source',
    author: 'Market Author 2',
    ownerId: 202,
    category: 'creativity',
    createdAt: '2024-02-04T00:00:00Z',
    updatedAt: '2024-02-05T00:00:00Z',
    avatar: 'https://example.com/avatar2.png',
    tags: ['market', 'creative'],
    status: 'published',
    tokenUsage: 128,
    config: {
      systemRole: 'You are a creative assistant.',
      knowledgeBases: [],
      plugins: [],
    },
  },
];

const mockMarketAgentDetail = {
  ...mockMarketAssistantList[0],
  documentationUrl: 'https://example.com/docs',
  version: '1.0.0',
  versions: [
    {
      version: '1.0.0',
      status: 'published',
      isLatest: true,
      isValidated: true,
      createdAt: '2024-02-02T00:00:00Z',
    },
  ],
  examples: [
    {
      content: 'Example content',
      role: 'user',
    },
  ],
};

const mockPluginList = [
  {
    identifier: 'plugin-1',
    title: 'Test Plugin 1',
    description: 'A test plugin',
    author: 'Plugin Author',
    category: 'tools',
    createdAt: '2024-01-01T00:00:00Z',
    tags: ['test', 'plugin'],
    manifest: 'https://example.com/plugin1/manifest.json',
  },
  {
    identifier: 'plugin-2',
    title: 'Test Plugin 2',
    description: 'Another test plugin',
    author: 'Plugin Author 2',
    category: 'utilities',
    createdAt: '2024-01-02T00:00:00Z',
    tags: ['test', 'utility'],
    manifest: 'https://example.com/plugin2/manifest.json',
  },
];

describe('DiscoverService', () => {
  let service: DiscoverService;
  let mockAssistantStore: any;
  let mockPluginStore: any;
  let mockMarket: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup AssistantStore mock
    mockAssistantStore = {
      getAgentIndex: vi
        .fn()
        .mockResolvedValue(mockAssistantList.map((item) => ({ ...item, meta: {} }))),
      getAgent: vi.fn().mockImplementation((identifier) => {
        const agent = mockAssistantList.find((a) => a.identifier === identifier);
        return Promise.resolve(agent ? { ...agent, meta: {} } : null);
      }),
    };

    // Setup PluginStore mock
    mockPluginStore = {
      getPluginList: vi
        .fn()
        .mockResolvedValue(mockPluginList.map((item) => ({ ...item, meta: {} }))),
    };

    // Setup MarketSDK mock
    mockMarket = {
      agents: {
        getAgentList: vi.fn().mockResolvedValue({
          items: mockMarketAssistantList,
          totalCount: mockMarketAssistantList.length,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
        }),
        getAgentDetail: vi.fn().mockResolvedValue(mockMarketAgentDetail),
        getCategories: vi.fn().mockResolvedValue([
          { category: 'productivity', count: 10 },
          { category: 'creativity', count: 5 },
        ]),
        getPublishedIdentifiers: vi.fn().mockResolvedValue([
          { id: 'market-assistant-1', lastModified: '2024-02-02T00:00:00Z' },
          { id: 'market-assistant-2', lastModified: '2024-02-05T00:00:00Z' },
        ]),
      },
      plugins: {
        getCategories: vi.fn().mockResolvedValue([
          { category: 'tools', count: 5 },
          { category: 'utilities', count: 3 },
        ]),
        getPluginDetail: vi.fn().mockImplementation((params) => {
          const plugin = mockPluginList.find((p) => p.identifier === params.identifier);
          return Promise.resolve(plugin || null);
        }),
        getPluginList: vi.fn().mockResolvedValue({
          items: mockPluginList,
          totalCount: mockPluginList.length,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
        }),
        getPublishedIdentifiers: vi
          .fn()
          .mockResolvedValue(
            mockPluginList.map((p) => ({ identifier: p.identifier, lastModified: p.createdAt })),
          ),
        getPluginManifest: vi.fn().mockResolvedValue({}),
      },
    };

    (AssistantStore as any).mockImplementation(() => mockAssistantStore);
    (PluginStore as any).mockImplementation(() => mockPluginStore);

    service = new DiscoverService();
    service.market = mockMarket;
  });

  describe('Assistant Market (new source)', () => {
    it('getAssistantList should transform market SDK response', async () => {
      const result = await service.getAssistantList();

      expect(mockMarket.agents.getAgentList).toHaveBeenCalled();
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          identifier: 'market-assistant-1',
          title: 'Market Assistant 1',
          author: 'Market Author 1',
          knowledgeCount: 1,
          pluginCount: 1,
        }),
      );
    });

    it('getAssistantDetail should fetch from market SDK by default', async () => {
      const result = await service.getAssistantDetail({
        identifier: 'market-assistant-1',
      });

      expect(mockMarket.agents.getAgentDetail).toHaveBeenCalledWith('market-assistant-1', {
        locale: 'en',
        version: undefined,
      });
      expect(result).toEqual(
        expect.objectContaining({
          identifier: 'market-assistant-1',
          title: 'Market Assistant 1',
          related: expect.any(Array),
        }),
      );
    });

    it('getAssistantCategories should proxy to market SDK', async () => {
      const result = await service.getAssistantCategories({ locale: 'en-US', q: 'market' });

      expect(mockMarket.agents.getCategories).toHaveBeenCalledWith({
        locale: 'en',
        q: 'market',
      });
      expect(result).toEqual([
        { category: 'productivity', count: 10 },
        { category: 'creativity', count: 5 },
      ]);
    });

    it('getAssistantIdentifiers should read from market SDK', async () => {
      const result = await service.getAssistantIdentifiers();

      expect(mockMarket.agents.getPublishedIdentifiers).toHaveBeenCalled();
      expect(result).toEqual([
        { identifier: 'market-assistant-1', lastModified: '2024-02-02T00:00:00Z' },
        { identifier: 'market-assistant-2', lastModified: '2024-02-05T00:00:00Z' },
      ]);
    });
  });

  describe('Assistant Market (legacy source)', () => {
    describe('getAssistantList', () => {
      it('should return formatted assistant list with default parameters', async () => {
        const result = await service.getAssistantList({ source: 'legacy' });

        expect(result).toEqual({
          currentPage: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          items: expect.arrayContaining([
            expect.objectContaining({
              identifier: 'assistant-1',
              title: 'Test Assistant 1',
            }),
            expect.objectContaining({
              identifier: 'assistant-2',
              title: 'Test Assistant 2',
            }),
            expect.objectContaining({
              identifier: 'assistant-3',
              title: 'Test Assistant 3',
            }),
          ]),
        });
      });

      it('should filter by category', async () => {
        const result = await service.getAssistantList({
          category: 'productivity',
          source: 'legacy',
        });

        expect(result.items).toHaveLength(2);
        expect(result.items.map((item) => item.identifier)).toContain('assistant-1');
        expect(result.items.map((item) => item.identifier)).toContain('assistant-2');
      });

      it('should filter by search query', async () => {
        const result = await service.getAssistantList({ q: 'creative', source: 'legacy' });

        expect(result.items).toHaveLength(2);
        expect(result.items.map((item) => item.identifier)).toContain('assistant-2');
        expect(result.items.map((item) => item.identifier)).toContain('assistant-3');
      });

      it('should paginate results', async () => {
        const result = await service.getAssistantList({ page: 1, pageSize: 1, source: 'legacy' });

        expect(result.items).toHaveLength(1);
        expect(result.currentPage).toBe(1);
        expect(result.pageSize).toBe(1);
        expect(result.totalPages).toBe(3);
      });
    });

    describe('getAssistantDetail', () => {
      it('should return assistant detail with related items', async () => {
        const result = await service.getAssistantDetail({
          identifier: 'assistant-1',
          source: 'legacy',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'assistant-1',
            title: 'Test Assistant 1',
            related: expect.any(Array),
          }),
        );
        expect(result?.related).toHaveLength(1);
        expect(result?.related[0].identifier).toBe('assistant-2');
      });

      it('should return undefined for non-existent assistant', async () => {
        mockAssistantStore.getAgent.mockResolvedValue(null);

        const result = await service.getAssistantDetail({
          identifier: 'non-existent',
          source: 'legacy',
        });

        expect(result).toBeUndefined();
      });
    });

    describe('getAssistantCategories', () => {
      it('should return category counts', async () => {
        const result = await service.getAssistantCategories({ source: 'legacy' });

        expect(result).toEqual([
          { category: 'productivity', count: 2 },
          { category: 'creativity', count: 1 },
        ]);
      });

      it('should filter categories by search query', async () => {
        const result = await service.getAssistantCategories({ q: 'creative', source: 'legacy' });

        expect(result).toEqual([
          {
            category: 'productivity',
            count: 1,
          },
          {
            category: 'creativity',
            count: 1,
          },
        ]);
      });
    });

    describe('getAssistantIdentifiers', () => {
      it('should return list of identifiers with lastModified dates', async () => {
        const result = await service.getAssistantIdentifiers({ source: 'legacy' });

        expect(result).toEqual([
          { identifier: 'assistant-1', lastModified: '2024-01-01T00:00:00Z' },
          { identifier: 'assistant-2', lastModified: '2024-01-02T00:00:00Z' },
          { identifier: 'assistant-3', lastModified: '2024-01-03T00:00:00Z' },
        ]);
      });
    });
  });

  describe('Plugin Market', () => {
    describe('getPluginList', () => {
      it('should return formatted plugin list with default parameters', async () => {
        const result = await service.getPluginList();

        expect(result).toEqual({
          currentPage: 1,
          pageSize: 20,
          totalCount: 2,
          totalPages: 1,
          items: expect.arrayContaining([
            expect.objectContaining({
              identifier: 'plugin-1',
              title: 'Test Plugin 1',
            }),
            expect.objectContaining({
              identifier: 'plugin-2',
              title: 'Test Plugin 2',
            }),
          ]),
        });
      });

      it('should filter by category', async () => {
        const result = await service.getPluginList({ category: 'tools' });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].identifier).toBe('plugin-1');
      });

      it('should sort by identifier', async () => {
        const result = await service.getPluginList({
          sort: PluginSorts.Identifier,
          order: 'asc',
        });

        // Note: The service has reversed logic for identifier sorting
        expect(result.items[0].identifier).toBe('plugin-2');
        expect(result.items[1].identifier).toBe('plugin-1');
      });
    });

    describe('getPluginDetail', () => {
      it('should return plugin detail with related items', async () => {
        const result = await service.getPluginDetail({
          identifier: 'plugin-1',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'plugin-1',
            title: 'Test Plugin 1',
            related: expect.any(Array),
          }),
        );
      });

      it('should return undefined for non-existent plugin', async () => {
        const result = await service.getPluginDetail({
          identifier: 'non-existent',
        });

        expect(result).toBeUndefined();
      });
    });
  });

  describe('MCP Market', () => {
    describe('getMcpList', () => {
      it('should call market SDK with normalized locale', async () => {
        await service.getMcpList({ locale: 'en-US' });

        expect(mockMarket.plugins.getPluginList).toHaveBeenCalledWith(
          expect.objectContaining({
            locale: 'en',
          }),
          expect.any(Object),
        );
      });
    });

    describe('getMcpDetail', () => {
      it('should return MCP detail with related items', async () => {
        const mockMcp = { identifier: 'mcp-1', category: 'tools' };
        mockMarket.plugins.getPluginDetail.mockResolvedValue(mockMcp);

        const result = await service.getMcpDetail({
          identifier: 'mcp-1',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'mcp-1',
            related: expect.any(Array),
          }),
        );
      });
    });
  });

  describe('Provider Market', () => {
    describe('getProviderList', () => {
      it('should return formatted provider list', async () => {
        const result = await service.getProviderList();

        expect(result.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              identifier: 'openai',
              name: 'OpenAI',
              modelCount: expect.any(Number),
            }),
            expect.objectContaining({
              identifier: 'anthropic',
              name: 'Anthropic',
              modelCount: expect.any(Number),
            }),
          ]),
        );
      });

      it('should filter by search query', async () => {
        const result = await service.getProviderList({ q: 'openai' });

        expect(result.items.length).toBeGreaterThan(0);
        expect(result.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              identifier: 'openai',
            }),
          ]),
        );
      });

      it('should sort by model count', async () => {
        const result = await service.getProviderList({
          sort: ProviderSorts.ModelCount,
          order: 'desc',
        });

        expect(result.items.length).toBeGreaterThan(0);
        for (let i = 1; i < result.items.length; i++) {
          expect(result.items[i - 1].modelCount).toBeGreaterThanOrEqual(result.items[i].modelCount);
        }
      });
    });

    describe('getProviderDetail', () => {
      it('should return provider detail', async () => {
        const result = await service.getProviderDetail({
          identifier: 'openai',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'openai',
            name: 'OpenAI',
            models: expect.any(Array),
            related: expect.any(Array),
          }),
        );
      });
    });
  });

  describe('Model Market', () => {
    describe('getModelList', () => {
      it('should return deduplicated model list', async () => {
        const result = await service.getModelList();

        expect(result.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              identifier: expect.any(String),
              displayName: expect.any(String),
              providers: expect.any(Array),
            }),
          ]),
        );
      });

      it('should filter by category', async () => {
        const result = await service.getModelList({ category: 'openai' });

        expect(result.items.length).toBeGreaterThan(0);
      });

      it('should sort by context window tokens', async () => {
        const result = await service.getModelList({
          sort: ModelSorts.ContextWindowTokens,
          order: 'desc',
        });

        expect(result.items).toHaveLength(2);
      });

      it('should filter by search query', async () => {
        const result = await service.getModelList({ q: 'gpt' });

        expect(result.items.length).toBeGreaterThan(0);
      });
    });

    describe('getModelDetail', () => {
      it('should return model detail with providers', async () => {
        const result = await service.getModelDetail({
          identifier: 'gpt-4',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'gpt-4',
            displayName: 'GPT-4',
            providers: expect.any(Array),
            related: expect.any(Array),
          }),
        );
      });
    });

    describe('getModelCategories', () => {
      it('should return model categories by provider', async () => {
        const result = await service.getModelCategories();

        expect(result).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              category: expect.any(String),
              count: expect.any(Number),
            }),
          ]),
        );
      });
    });
  });

  describe('Helper Methods', () => {
    describe('calculateAbilitiesScore', () => {
      it('should calculate abilities score correctly', () => {
        const abilities = {
          vision: true,
          functionCall: true,
          files: false,
        };

        // Access private method for testing
        const score = (service as any).calculateAbilitiesScore(abilities);
        expect(score).toBe(2); // vision + functionCall
      });

      it('should return 0 for empty abilities', () => {
        const score = (service as any).calculateAbilitiesScore(null);
        expect(score).toBe(0);
      });
    });

    describe('selectModelWithBestAbilities', () => {
      it('should select model with best abilities', () => {
        const models = [
          {
            identifier: 'model-1',
            abilities: { vision: true },
            contextWindowTokens: 4000,
          },
          {
            identifier: 'model-1',
            abilities: { vision: true, functionCall: true },
            contextWindowTokens: 8000,
          },
        ];

        const result = (service as any).selectModelWithBestAbilities(models);

        expect(result.abilities).toEqual({ vision: true, functionCall: true });
        expect(result.contextWindowTokens).toBe(8000);
      });

      it('should return single model if only one provided', () => {
        const models = [{ identifier: 'model-1', abilities: {} }];

        const result = (service as any).selectModelWithBestAbilities(models);

        expect(result).toEqual(models[0]);
      });
    });
  });
});
