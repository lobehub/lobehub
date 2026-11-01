/**
 * Mock data for Discover/Community module.
 *
 * Community E2E tests should not depend on the live marketplace service. These
 * fixtures mirror the data shape returned by the app's tRPC market router.
 */
import type {
  AssistantListResponse,
  DiscoverAssistantItem,
  DiscoverMcpItem,
  DiscoverModelItem,
  DiscoverProviderItem,
  McpListResponse,
  ModelListResponse,
  ProviderListResponse,
} from './types';

const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-10T00:00:00.000Z';

// ============================================
// Assistant Mock Data
// ============================================

export const mockAssistantItems: DiscoverAssistantItem[] = [
  {
    author: 'LobeHub',
    avatar: '🤖',
    backgroundColor: '#1890ff',
    category: 'general',
    config: {
      openingMessage: 'Hello, I am your general assistant.',
      openingQuestions: ['What can you do?'],
      params: {},
      plugins: [],
      systemRole: 'You are a helpful general-purpose assistant for E2E tests.',
    },
    createdAt: CREATED_AT,
    description: 'A versatile AI assistant for general tasks and conversations.',
    identifier: 'general-assistant',
    installCount: 1000,
    knowledgeCount: 1,
    pluginCount: 0,
    summary: 'General-purpose assistant fixture.',
    tags: ['general', 'fixture'],
    title: 'General Assistant',
    tokenUsage: 4096,
    type: 'agent',
    updatedAt: UPDATED_AT,
    userName: 'lobehub',
  },
  {
    author: 'LobeHub',
    avatar: '💻',
    backgroundColor: '#52c41a',
    category: 'programming',
    config: {
      openingMessage: 'Ready to help with development tasks.',
      openingQuestions: ['Review this function'],
      params: {},
      plugins: [],
      systemRole: 'You are an expert coding assistant for E2E tests.',
    },
    createdAt: CREATED_AT,
    description: 'Developer and coding assistant for software engineering workflows.',
    identifier: 'code-assistant',
    installCount: 800,
    knowledgeCount: 2,
    pluginCount: 1,
    summary: 'Developer assistant fixture.',
    tags: ['developer', 'programming'],
    title: 'Code Assistant',
    tokenUsage: 8192,
    type: 'agent',
    updatedAt: UPDATED_AT,
    userName: 'lobehub',
  },
  {
    author: 'LobeHub',
    avatar: '🎓',
    backgroundColor: '#faad14',
    category: 'academic',
    config: {
      openingMessage: 'Let us study together.',
      openingQuestions: ['Explain this concept'],
      params: {},
      plugins: [],
      systemRole: 'You are an academic tutor for E2E tests.',
    },
    createdAt: CREATED_AT,
    description: 'Academic research and study assistant for reliable category filtering.',
    identifier: 'academic-tutor',
    installCount: 640,
    knowledgeCount: 3,
    pluginCount: 0,
    summary: 'Academic assistant fixture.',
    tags: ['academic', 'education'],
    title: 'Academic Tutor',
    tokenUsage: 4096,
    type: 'agent',
    updatedAt: UPDATED_AT,
    userName: 'lobehub',
  },
  {
    author: 'LobeHub',
    avatar: '✍️',
    backgroundColor: '#722ed1',
    category: 'copywriting',
    config: {
      openingMessage: 'Tell me what you want to write.',
      openingQuestions: ['Draft a product intro'],
      params: {},
      plugins: [],
      systemRole: 'You are a writing assistant for E2E tests.',
    },
    createdAt: CREATED_AT,
    description: 'Professional writing assistant for content creation.',
    identifier: 'writing-assistant',
    installCount: 600,
    knowledgeCount: 1,
    pluginCount: 0,
    summary: 'Writing assistant fixture.',
    tags: ['copywriting'],
    title: 'Writing Assistant',
    tokenUsage: 4096,
    type: 'agent',
    updatedAt: UPDATED_AT,
    userName: 'lobehub',
  },
];

export const mockAssistantList: AssistantListResponse = {
  currentPage: 1,
  items: mockAssistantItems,
  pageSize: 21,
  totalCount: 42,
  totalPages: 2,
};

export const mockAssistantCategories = [
  { category: 'general', count: 12 },
  { category: 'programming', count: 10 },
  { category: 'academic', count: 8 },
  { category: 'copywriting', count: 6 },
];

// ============================================
// Model Mock Data
// ============================================

export const mockModelItems: DiscoverModelItem[] = [
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 128_000,
    description: 'Most capable fixture model for complex tasks.',
    displayName: 'GPT-4o',
    id: 'gpt-4o',
    identifier: 'gpt-4o',
    providerCount: 2,
    providers: ['openai', 'lobehub'],
    releasedAt: CREATED_AT,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: false },
    contextWindowTokens: 200_000,
    description: 'Advanced AI assistant fixture by Anthropic.',
    displayName: 'Claude 3.5 Sonnet',
    id: 'claude-3-5-sonnet-20241022',
    identifier: 'claude-3-5-sonnet-20241022',
    providerCount: 1,
    providers: ['anthropic'],
    releasedAt: CREATED_AT,
    type: 'chat',
  },
  {
    abilities: { functionCall: false, reasoning: false, vision: false },
    contextWindowTokens: 32_768,
    description: 'Open source language model fixture.',
    displayName: 'Llama 3.1 70B',
    id: 'llama-3.1-70b',
    identifier: 'llama-3.1-70b',
    providerCount: 1,
    providers: ['meta'],
    releasedAt: CREATED_AT,
    type: 'chat',
  },
];

export const mockModelList: ModelListResponse = {
  currentPage: 1,
  items: mockModelItems,
  pageSize: 21,
  totalCount: mockModelItems.length,
  totalPages: 1,
};

// ============================================
// Provider Mock Data
// ============================================

export const mockProviderItems: DiscoverProviderItem[] = [
  {
    description: 'Leading AI research company fixture.',
    identifier: 'openai',
    modelCount: 2,
    models: ['gpt-4o', 'gpt-4o-mini'],
    name: 'OpenAI',
    url: 'https://openai.com',
  },
  {
    description: 'AI safety focused research company fixture.',
    identifier: 'anthropic',
    modelCount: 1,
    models: ['claude-3-5-sonnet-20241022'],
    name: 'Anthropic',
    url: 'https://anthropic.com',
  },
  {
    description: 'Open source AI leader fixture.',
    identifier: 'meta',
    modelCount: 1,
    models: ['llama-3.1-70b'],
    name: 'Meta',
    url: 'https://ai.meta.com',
  },
];

export const mockProviderList: ProviderListResponse = {
  currentPage: 1,
  items: mockProviderItems,
  pageSize: 21,
  totalCount: mockProviderItems.length,
  totalPages: 1,
};

// ============================================
// MCP Mock Data
// ============================================

export const mockMcpItems: DiscoverMcpItem[] = [
  {
    author: 'LobeHub',
    capabilities: { prompts: false, resources: false, tools: true },
    category: 'business',
    connectionType: 'stdio',
    createdAt: CREATED_AT,
    description: 'Business automation MCP tool fixture.',
    github: { stars: 1200, url: 'https://github.com/lobehub/e2e-business-mcp' },
    icon: '📊',
    identifier: 'business-automation',
    installCount: 500,
    installationMethods: 'npm',
    isClaimed: true,
    isFeatured: true,
    isOfficial: true,
    isValidated: true,
    manifestUrl: 'https://example.com/business-automation/manifest.json',
    name: 'Business Automation',
    toolsCount: 3,
    updatedAt: UPDATED_AT,
  },
  {
    author: 'LobeHub',
    capabilities: { prompts: false, resources: true, tools: true },
    category: 'developer',
    connectionType: 'stdio',
    createdAt: CREATED_AT,
    description: 'Developer file-system MCP fixture.',
    github: { stars: 900, url: 'https://github.com/lobehub/e2e-file-mcp' },
    icon: '📁',
    identifier: 'file-manager',
    installCount: 300,
    installationMethods: 'npm',
    isClaimed: true,
    isFeatured: false,
    isOfficial: false,
    isValidated: true,
    manifestUrl: 'https://example.com/file-manager/manifest.json',
    name: 'File Manager',
    resourcesCount: 2,
    toolsCount: 5,
    updatedAt: UPDATED_AT,
  },
  {
    author: 'LobeHub',
    capabilities: { prompts: true, resources: false, tools: true },
    category: 'productivity',
    connectionType: 'http',
    createdAt: CREATED_AT,
    description: 'Productivity search MCP fixture.',
    github: { stars: 600, url: 'https://github.com/lobehub/e2e-search-mcp' },
    icon: '🔍',
    identifier: 'web-search',
    installCount: 260,
    installationMethods: 'docker',
    isClaimed: false,
    isFeatured: false,
    isOfficial: false,
    isValidated: true,
    manifestUrl: 'https://example.com/web-search/manifest.json',
    name: 'Web Search',
    promptsCount: 1,
    toolsCount: 2,
    updatedAt: UPDATED_AT,
  },
];

export const mockMcpList: McpListResponse = {
  categories: ['business', 'developer', 'productivity'],
  currentPage: 1,
  items: mockMcpItems,
  pageSize: 21,
  totalCount: mockMcpItems.length,
  totalPages: 1,
};

export const mockMcpCategories = [
  { category: 'business', count: 7 },
  { category: 'developer', count: 5 },
  { category: 'productivity', count: 3 },
];

// ============================================
// Detail Mock Data
// ============================================

export const mockAssistantDetails = mockAssistantItems.map((item) => ({
  ...item,
  currentVersion: '1.0.0',
  related: mockAssistantItems
    .filter((related) => related.identifier !== item.identifier)
    .slice(0, 3),
  versions: [
    {
      createdAt: item.createdAt,
      isLatest: true,
      isValidated: true,
      status: 'published',
      version: '1.0.0',
    },
  ],
}));

export const mockMcpDetails = mockMcpItems.map((item) => ({
  ...item,
  author: { name: item.author ?? 'LobeHub', url: 'https://lobehub.com' },
  deploymentOptions: [
    {
      connection: { command: 'npx', type: item.connectionType ?? 'stdio' },
      installationMethod: item.installationMethods ?? 'npm',
      title: 'E2E recommended deployment',
    },
  ],
  overview: {
    readme: `# ${item.name}\n\n${item.description}`,
    summary: item.description,
  },
  related: mockMcpItems.filter((related) => related.identifier !== item.identifier).slice(0, 2),
  tools: [{ description: 'Fixture tool for E2E tests', name: 'fixtureTool' }],
  version: '1.0.0',
  versions: [{ isLatest: true, version: '1.0.0' }],
}));

export const mockModelDetails = mockModelItems.map((item) => ({
  ...item,
  providers: mockProviderItems.map((provider) => ({
    ...provider,
    id: provider.identifier,
    model: item,
  })),
  related: mockModelItems.filter((related) => related.identifier !== item.identifier).slice(0, 2),
}));

export const mockProviderDetails = mockProviderItems.map((item) => ({
  ...item,
  models: mockModelItems
    .filter((model) => item.models.includes(model.identifier))
    .map((model) => ({ ...model, maxOutput: 4096 })),
  readme: `# ${item.name}\n\n${item.description}`,
  related: mockProviderItems
    .filter((related) => related.identifier !== item.identifier)
    .slice(0, 2),
}));
