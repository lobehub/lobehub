/**
 * Mock data for Discover/Community module
 */
import type {
  AssistantListResponse,
  McpListResponse,
  ModelListResponse,
  ProviderListResponse,
} from './types';

// ============================================
// Assistant Mock Data
// ============================================

export const mockAssistantList: AssistantListResponse = {
  items: [
    {
      author: 'LobeHub',
      avatar: '🤖',
      backgroundColor: '#1890ff',
      category: 'general',
      createdAt: '2024-01-01T00:00:00.000Z',
      description: 'A versatile AI assistant for general tasks and conversations.',
      identifier: 'general-assistant',
      installCount: 1000,
      knowledgeCount: 5,
      pluginCount: 3,
      title: 'General Assistant',
      tokenUsage: 4096,
      userName: 'lobehub',
    },
    {
      author: 'LobeHub',
      avatar: '💻',
      backgroundColor: '#52c41a',
      category: 'programming',
      createdAt: '2024-01-02T00:00:00.000Z',
      description: 'Expert coding assistant for software development.',
      identifier: 'code-assistant',
      installCount: 800,
      knowledgeCount: 10,
      pluginCount: 5,
      title: 'Code Assistant',
      tokenUsage: 8192,
      userName: 'lobehub',
    },
    {
      author: 'LobeHub',
      avatar: '✍️',
      backgroundColor: '#722ed1',
      category: 'copywriting',
      createdAt: '2024-01-03T00:00:00.000Z',
      description: 'Professional writing assistant for content creation.',
      identifier: 'writing-assistant',
      installCount: 600,
      knowledgeCount: 3,
      pluginCount: 2,
      title: 'Writing Assistant',
      tokenUsage: 4096,
      userName: 'lobehub',
    },
  ],
  pagination: {
    page: 1,
    pageSize: 12,
    total: 3,
    totalPages: 1,
  },
};

export const mockAssistantCategories = [
  { id: 'general', name: 'General' },
  { id: 'programming', name: 'Programming' },
  { id: 'copywriting', name: 'Copywriting' },
  { id: 'education', name: 'Education' },
];

// ============================================
// Model Mock Data
// ============================================

export const mockModelList: ModelListResponse = {
  items: [
    {
      abilities: { functionCall: true, reasoning: true, vision: true },
      contextWindowTokens: 128_000,
      createdAt: '2024-01-01T00:00:00.000Z',
      description: 'Most capable model for complex tasks',
      displayName: 'GPT-4o',
      id: 'gpt-4o',
      providerId: 'openai',
      providerName: 'OpenAI',
      type: 'chat',
    },
    {
      abilities: { functionCall: true, reasoning: true, vision: false },
      contextWindowTokens: 200_000,
      createdAt: '2024-01-02T00:00:00.000Z',
      description: 'Advanced AI assistant by Anthropic',
      displayName: 'Claude 3.5 Sonnet',
      id: 'claude-3-5-sonnet-20241022',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      type: 'chat',
    },
    {
      abilities: { functionCall: false, reasoning: false, vision: false },
      contextWindowTokens: 32_768,
      createdAt: '2024-01-03T00:00:00.000Z',
      description: 'Open source language model',
      displayName: 'Llama 3.1 70B',
      id: 'llama-3.1-70b',
      providerId: 'meta',
      providerName: 'Meta',
      type: 'chat',
    },
  ],
  pagination: {
    page: 1,
    pageSize: 12,
    total: 3,
    totalPages: 1,
  },
};

// ============================================
// Provider Mock Data
// ============================================

export const mockProviderList: ProviderListResponse = {
  items: [
    {
      description: 'Leading AI research company',
      id: 'openai',
      logo: 'https://example.com/openai.png',
      modelCount: 10,
      name: 'OpenAI',
    },
    {
      description: 'AI safety focused research company',
      id: 'anthropic',
      logo: 'https://example.com/anthropic.png',
      modelCount: 5,
      name: 'Anthropic',
    },
    {
      description: 'Open source AI leader',
      id: 'meta',
      logo: 'https://example.com/meta.png',
      modelCount: 8,
      name: 'Meta',
    },
  ],
  pagination: {
    page: 1,
    pageSize: 12,
    total: 3,
    totalPages: 1,
  },
};

// ============================================
// MCP Mock Data
// ============================================

export const mockMcpList: McpListResponse = {
  items: [
    {
      author: 'LobeHub',
      avatar: '🔍',
      category: 'search',
      createdAt: '2024-01-01T00:00:00.000Z',
      description: 'Web search capabilities for AI assistants',
      identifier: 'web-search',
      installCount: 500,
      title: 'Web Search',
    },
    {
      author: 'LobeHub',
      avatar: '📁',
      category: 'file',
      createdAt: '2024-01-02T00:00:00.000Z',
      description: 'File system operations and management',
      identifier: 'file-manager',
      installCount: 300,
      title: 'File Manager',
    },
    {
      author: 'LobeHub',
      avatar: '🗄️',
      category: 'database',
      createdAt: '2024-01-03T00:00:00.000Z',
      description: 'Database query and management tools',
      identifier: 'db-tools',
      installCount: 200,
      title: 'Database Tools',
    },
  ],
  pagination: {
    page: 1,
    pageSize: 12,
    total: 3,
    totalPages: 1,
  },
};

export const mockMcpCategories = [
  { id: 'search', name: 'Search' },
  { id: 'file', name: 'File' },
  { id: 'database', name: 'Database' },
  { id: 'utility', name: 'Utility' },
];
