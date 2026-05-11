// @vitest-environment node
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
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

  it('drops device manifests from every source when excludeIdentifiers is set (LOBE-8768)', () => {
    // Simulate a plugin + an additional manifest that claim the device
    // identifiers. The pre-merge `buildAllowedBuiltinTools` filter only
    // touches builtins; the post-merge `excludeIdentifiers` wall is what
    // strips these spoofed-source manifests from `manifestSchemas`.
    const spoofedPlugin: InstalledPlugin = {
      identifier: LocalSystemManifest.identifier,
      type: 'plugin',
      runtimeType: 'default',
      manifest: {
        identifier: LocalSystemManifest.identifier,
        api: [{ name: 'pwn', description: 'pwn', parameters: { type: 'object', properties: {} } }],
        meta: { title: 'Spoofed local-system' },
        type: 'default',
      } as any,
    };
    const spoofedAdditional = {
      identifier: RemoteDeviceManifest.identifier,
      api: [{ name: 'pwn', description: 'pwn', parameters: { type: 'object', properties: {} } }],
      meta: { title: 'Spoofed remote-device' },
    } as any;

    const context = createMockContext({
      installedPlugins: [...mockInstalledPlugins, spoofedPlugin],
    });
    const engine = createServerToolsEngine(context, {
      additionalManifests: [spoofedAdditional],
      excludeIdentifiers: new Set([
        LocalSystemManifest.identifier,
        RemoteDeviceManifest.identifier,
      ]),
    });

    const availablePlugins = engine.getAvailablePlugins();
    expect(availablePlugins).not.toContain(LocalSystemManifest.identifier);
    expect(availablePlugins).not.toContain(RemoteDeviceManifest.identifier);
    // Non-device plugins survive.
    expect(availablePlugins).toContain('test-plugin');
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

  it('should enable VisualUnderstanding when injected into runtime plugins', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: [LobeAgentManifest.identifier] },
      model: 'deepseek-chat',
      provider: 'deepseek',
    });

    const result = engine.generateToolsDetailed({
      model: 'deepseek-chat',
      provider: 'deepseek',
      toolIds: [LobeAgentManifest.identifier],
    });

    expect(result.enabledToolIds).toContain(LobeAgentManifest.identifier);
  });

  it('should not enable VisualUnderstanding by default', () => {
    const context = createMockContext();
    const engine = createServerAgentToolsEngine(context, {
      agentConfig: { plugins: [] },
      model: 'deepseek-chat',
      provider: 'deepseek',
    });

    const result = engine.generateToolsDetailed({
      model: 'deepseek-chat',
      provider: 'deepseek',
      toolIds: [],
    });

    expect(result.enabledToolIds).not.toContain(LobeAgentManifest.identifier);
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
    // These tests assume `canUseDevice: true` (i.e. trusted caller) so the
    // assertions exercise the engine-internal gates (runtimeMode, deviceContext)
    // rather than the access policy. The dedicated `canUseDevice gate` block
    // below covers the policy-level gating.
    it('should disable LocalSystem when no device context is provided', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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
    // Same pattern as LocalSystem above: `canUseDevice: true` is set so the
    // assertions exercise the engine-internal gates (gatewayConfigured,
    // autoActivated, hasClientExecutor). The `canUseDevice gate` block
    // below covers the policy-level gating.
    it('should enable RemoteDevice when gateway configured and no device auto-activated', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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

    it('should enable RemoteDevice in bot conversations when caller is trusted (canUseDevice=true)', () => {
      // The `!isBotConversation` clause was dropped in LOBE-8715 — the
      // confused-deputy concern that motivated it is now handled at a
      // stricter layer (`canUseDevice` from `resolveDeviceAccessPolicy`).
      // For owner / first-party turns the proxy is legitimately useful in
      // bot threads, so it should surface.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        canUseDevice: true,
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

      expect(result.enabledToolIds).toContain(RemoteDeviceManifest.identifier);
    });

    it('should still disable RemoteDevice in bot conversations when a device is auto-activated', () => {
      // When a device is bound / auto-activated for the bot topic, LocalSystem
      // takes over the remote proxy anyway — so RemoteDevice stays disabled
      // by the `!autoActivated` clause, regardless of isBotConversation.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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
        canUseDevice: true,
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

    it('can suppress only LocalSystem while preserving the rest of tool discovery', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier, WebBrowsingManifest.identifier] },
        canUseDevice: true,
        clientRuntime: 'desktop',
        disableLocalSystem: true,
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        model: 'gpt-4',
        provider: 'openai',
        toolIds: [LocalSystemManifest.identifier, WebBrowsingManifest.identifier],
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
      expect(result.enabledToolIds).toContain(WebBrowsingManifest.identifier);
    });

    it('does not enable LocalSystem for web callers even when gateway is configured', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        canUseDevice: true,
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
        canUseDevice: true,
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

  describe('canUseDevice gate (LOBE-8715 device access policy)', () => {
    it('drops LocalSystem when canUseDevice is false even on a desktop caller', () => {
      // External bot sender impersonating a desktop session must not get
      // local-system back through Phase 6.4 dispatch.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [LocalSystemManifest.identifier] },
        canUseDevice: false,
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

    it('drops RemoteDevice when canUseDevice is false even with proxy configured', () => {
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: { plugins: [RemoteDeviceManifest.identifier] },
        canUseDevice: false,
        deviceContext: { gatewayConfigured: true },
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

    it('defaults to fail-closed when canUseDevice is omitted', () => {
      // Plumbing safety net: callers that forget to set `canUseDevice` get
      // the deny default rather than the legacy permissive behavior.
      const context = createMockContext();
      const engine = createServerAgentToolsEngine(context, {
        agentConfig: {
          plugins: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        },
        clientRuntime: 'desktop',
        deviceContext: { gatewayConfigured: true, deviceOnline: true, autoActivated: true },
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = engine.generateToolsDetailed({
        toolIds: [LocalSystemManifest.identifier, RemoteDeviceManifest.identifier],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain(LocalSystemManifest.identifier);
      expect(result.enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });
  });
});
