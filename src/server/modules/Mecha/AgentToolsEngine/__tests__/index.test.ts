// @vitest-environment node
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { ToolsEngine } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { builtinTools } from '@/tools';

import { createServerAgentToolsEngine, createServerToolsEngine } from '../index';
import { type InstalledPlugin, type ServerAgentToolsContext } from '../types';

// Mock installed plugins
const mockInstalledPlugins: InstalledPlugin[] = [
  {
    identifier: 'test-plugin',
    type: 'plugin',
    runtimeType: 'default',
    manifest: {
      identifier: 'test-plugin',
      api: [
        {
          name: 'testApi',
          description: 'Test API',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Input string' },
            },
            required: ['input'],
          },
        },
      ],
      meta: {
        title: 'Test Plugin',
        description: 'A test plugin',
        avatar: '🧪',
      },
      type: 'default',
    },
  },
  {
    identifier: 'another-plugin',
    type: 'plugin',
    runtimeType: 'default',
    manifest: {
      identifier: 'another-plugin',
      api: [
        {
          name: 'anotherApi',
          description: 'Another API',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      ],
      meta: {
        title: 'Another Plugin',
        description: 'Another test plugin',
        avatar: '🔧',
      },
      type: 'default',
    },
  },
];

// Create mock context
const createMockContext = (
  overrides: Partial<ServerAgentToolsContext> = {},
): ServerAgentToolsContext => ({
  installedPlugins: mockInstalledPlugins,
  isModelSupportToolUse: () => true,
  ...overrides,
});

describe('createServerToolsEngine', () => {
  it('should return a ToolsEngine instance', () => {
    const context = createMockContext();
    const engine = createServerToolsEngine(context);

    expect(engine).toBeInstanceOf(ToolsEngine);
  });

  it('should generate tools for enabled plugins', () => {
    const context = createMockContext();
    const engine = createServerToolsEngine(context);

    const result = engine.generateTools({
      toolIds: ['test-plugin'],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
  });

  it('should return undefined when no plugins match', () => {
    const context = createMockContext({ installedPlugins: [] });
    const engine = createServerToolsEngine(context);

    const result = engine.generateTools({
      toolIds: ['non-existent'],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result).toBeUndefined();
  });

  it('should include builtin tools', () => {
    const context = createMockContext();
    const engine = createServerToolsEngine(context);

    const availablePlugins = engine.getAvailablePlugins();

    // Should include builtin tools
    for (const tool of builtinTools) {
      expect(availablePlugins).toContain(tool.identifier);
    }
  });

  it('should include additional manifests when provided', () => {
    const context = createMockContext();
    const engine = createServerToolsEngine(context, {
      additionalManifests: [
        {
          identifier: 'additional-tool',
          api: [
            { name: 'test', description: 'test', parameters: { type: 'object', properties: {} } },
          ],
          meta: { title: 'Additional', avatar: '➕' },
        } as any,
      ],
    });

    const availablePlugins = engine.getAvailablePlugins();
    expect(availablePlugins).toContain('additional-tool');
  });
});

describe('createServerAgentToolsEngine', () => {
  it('should return a ToolsEngine instance', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: [] },
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(engine).toBeInstanceOf(ToolsEngine);
  });

  it('should filter LocalSystem tool on server', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: [LocalSystemManifest.identifier] },
      model: 'gpt-4',
      provider: 'openai',
    });

    const result = engine.generateToolsDetailed({
      toolIds: [LocalSystemManifest.identifier],
      model: 'gpt-4',
      provider: 'openai',
    });

    // LocalSystem should be filtered out (disabled) on server
    expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
  });

  it('should enable WebBrowsing when search mode is on', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: {
        plugins: [WebBrowsingManifest.identifier],
        chatConfig: { searchMode: 'on' },
      },
      model: 'gpt-4',
      provider: 'openai',
    });

    const result = engine.generateToolsDetailed({
      toolIds: [WebBrowsingManifest.identifier],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result.enabledToolIds).toContain(WebBrowsingManifest.identifier);
  });

  it('should disable WebBrowsing when search mode is off', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: {
        plugins: [WebBrowsingManifest.identifier],
        chatConfig: { searchMode: 'off' },
      },
      model: 'gpt-4',
      provider: 'openai',
    });

    const result = engine.generateToolsDetailed({
      toolIds: [WebBrowsingManifest.identifier],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result.enabledToolIds).not.toContain(WebBrowsingManifest.identifier);
  });

  it('should enable KnowledgeBase when hasEnabledKnowledgeBases is true', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: [KnowledgeBaseManifest.identifier] },
      model: 'gpt-4',
      provider: 'openai',
      hasEnabledKnowledgeBases: true,
    });

    const result = engine.generateToolsDetailed({
      toolIds: [KnowledgeBaseManifest.identifier],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result.enabledToolIds).toContain(KnowledgeBaseManifest.identifier);
  });

  it('should disable KnowledgeBase when hasEnabledKnowledgeBases is false', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: [KnowledgeBaseManifest.identifier] },
      model: 'gpt-4',
      provider: 'openai',
      hasEnabledKnowledgeBases: false,
    });

    const result = engine.generateToolsDetailed({
      toolIds: [KnowledgeBaseManifest.identifier],
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result.enabledToolIds).not.toContain(KnowledgeBaseManifest.identifier);
  });

  it('should include default tools (WebBrowsing, KnowledgeBase)', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: {
        plugins: ['test-plugin'],
        chatConfig: { searchMode: 'on' },
      },
      model: 'gpt-4',
      provider: 'openai',
      hasEnabledKnowledgeBases: true,
    });

    const result = engine.generateToolsDetailed({
      toolIds: ['test-plugin'],
      model: 'gpt-4',
      provider: 'openai',
    });

    // Should include default tools alongside user tools
    expect(result.enabledToolIds).toContain('test-plugin');
    expect(result.enabledToolIds).toContain(WebBrowsingManifest.identifier);
    expect(result.enabledToolIds).toContain(KnowledgeBaseManifest.identifier);
  });

  it('should return undefined tools when model does not support function calling', () => {
    const context = createMockContext({
      isModelSupportToolUse: () => false,
    });
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: ['test-plugin'] },
      model: 'gpt-3.5-turbo',
      provider: 'openai',
    });

    const result = engine.generateTools({
      toolIds: ['test-plugin'],
      model: 'gpt-3.5-turbo',
      provider: 'openai',
    });

    expect(result).toBeUndefined();
  });
});
