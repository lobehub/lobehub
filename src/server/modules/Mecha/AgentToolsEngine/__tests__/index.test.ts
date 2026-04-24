// @vitest-environment node
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { builtinTools } from '@lobechat/builtin-tools';
import { ToolsEngine } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

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

  describe('Memory tool enable rules', () => {
    it('should disable Memory tool by default (globalMemoryEnabled = false)', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [MemoryManifest.identifier] },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [MemoryManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(MemoryManifest.identifier);
    });

    it('should enable Memory tool when globalMemoryEnabled is true', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [MemoryManifest.identifier] },
        globalMemoryEnabled: true,
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [MemoryManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain(MemoryManifest.identifier);
    });
  });

  describe('LocalSystem tool enable rules', () => {
    it('should disable LocalSystem when no device context is provided', () => {
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

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
    });

    it('should enable LocalSystem when gateway configured, device online AND auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        deviceContext: { gatewayConfigured: true, deviceOnline: true, autoActivated: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain(LocalSystemManifest.identifier);
    });

    it('should disable LocalSystem when device online but NOT auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        deviceContext: { gatewayConfigured: true, deviceOnline: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
    });

    it('should disable LocalSystem when gateway configured but device offline', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        deviceContext: { gatewayConfigured: true, deviceOnline: false, autoActivated: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
    });

    it('should disable LocalSystem when runtimeMode is explicitly set to cloud', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: {
          plugins: [LocalSystemManifest.identifier],
          chatConfig: { runtimeEnv: { runtimeMode: { desktop: 'cloud' } } },
        },
        deviceContext: { gatewayConfigured: true, deviceOnline: true, autoActivated: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
    });
  });

  describe('RemoteDevice tool enable rules', () => {
    it('should enable RemoteDevice when gateway configured and no device auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        deviceContext: { gatewayConfigured: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain(RemoteDeviceManifest.identifier);
    });

    it('should disable RemoteDevice when gateway not configured', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        deviceContext: { gatewayConfigured: false },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });

    it('should disable RemoteDevice when device is already auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        deviceContext: { gatewayConfigured: true, autoActivated: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });

    it('should disable RemoteDevice in bot conversations when no device auto-activated', () => {
      // Bot callers (Telegram/Discord/Slack) have no client-executor, so the
      // legacy rule would auto-enable RemoteDevice, and its systemRole would
      // hijack the Activator and tell the model to ask the user to open the
      // desktop app — blocking cloud-tool discovery (e.g. Klavis Gmail).
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        deviceContext: { gatewayConfigured: true },
        isBotConversation: true,
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });

    it('should still enable RemoteDevice in bot conversations when a device is auto-activated', () => {
      // When a device is bound / auto-activated for the bot topic, LocalSystem
      // takes over the remote proxy anyway — so RemoteDevice stays disabled
      // (its usual rule), not due to isBotConversation.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        deviceContext: { gatewayConfigured: true, deviceOnline: true, autoActivated: true },
        isBotConversation: true,
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });
  });

  describe('LocalSystem + RemoteDevice interaction', () => {
    it('should enable only RemoteDevice (not LocalSystem) when device online but not auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: {
          plugins: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        },
        deviceContext: { gatewayConfigured: true, deviceOnline: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
      expect(result.enabledToolIds).toContain(RemoteDeviceManifest.identifier);
    });

    it('should enable only LocalSystem (not RemoteDevice) when device auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: {
          plugins: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        },
        deviceContext: { gatewayConfigured: true, deviceOnline: true, autoActivated: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain(LocalSystemManifest.identifier);
      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });
  });

  describe('clientRuntime === "desktop" (Phase 6.4)', () => {
    it('enables LocalSystem when caller is desktop, regardless of device-proxy config', () => {
      // The Agent Gateway WS used to push `tool_execute` is orthogonal to
      // the legacy device-proxy. A desktop Electron caller is already the
      // execution target — no device-proxy prerequisite required.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        clientRuntime: 'desktop',
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain(LocalSystemManifest.identifier);
    });

    it('respects agent-level runtimeMode opt-out for desktop callers', () => {
      // User has configured the agent to NOT use local runtime on desktop.
      // Even though the caller is a desktop client, local-system stays off.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: {
          chatConfig: {
            runtimeEnv: { runtimeMode: { desktop: 'none' } },
          },
          plugins: [LocalSystemManifest.identifier],
        },
        clientRuntime: 'desktop',
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
    });

    it('does not enable LocalSystem for web callers even when gateway is configured', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        clientRuntime: 'web',
        deviceContext: { gatewayConfigured: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
    });

    it('suppresses RemoteDevice when caller is a desktop client', () => {
      // Even when device-proxy is configured, a desktop caller has local IPC
      // so the proxy is redundant. Otherwise the LLM might pick RemoteDevice
      // first (via `listOnlineDevices` / `activateDevice`) and route tool calls
      // to a *different* registered device instead of back to the caller.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: {
          plugins: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        },
        clientRuntime: 'desktop',
        deviceContext: { gatewayConfigured: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain(LocalSystemManifest.identifier);
      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });
  });
});
