import { AuvManifest } from '@lobechat/builtin-tool-auv';
import { groupSupervisorToolIds } from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import { filterAllowedBuiltinTools } from './deviceTools';
import { resolveToolRules } from './resolveToolRules';
import type { ToolRuleRequest } from './types';

const request = (overrides: Partial<ToolRuleRequest> = {}): ToolRuleRequest => ({
  agent: { chatConfig: {}, plugins: ['my-plugin'] },
  executionTarget: 'sandbox',
  localExecutionReady: false,
  model: { canUseFC: true },
  ...overrides,
});

describe('resolveToolRules', () => {
  it('derives the three modes from the chat config, never from the model', () => {
    expect(resolveToolRules(request()).toolMode).toBe('agent');
    expect(
      resolveToolRules(request({ agent: { chatConfig: { enableAgentMode: false }, plugins: [] } }))
        .toolMode,
    ).toBe('chat');
    expect(
      resolveToolRules(request({ agent: { chatConfig: { toolMode: 'custom' }, plugins: [] } }))
        .toolMode,
    ).toBe('custom');
    // A model without function calling keeps the stored mode; the tools
    // engine marks the tools incompatible instead.
    expect(resolveToolRules(request({ model: { canUseFC: false } })).toolMode).toBe('agent');
  });

  it('chat mode is a strict whitelist with no activator and no always-on tools', () => {
    const resolved = resolveToolRules(
      request({
        agent: { chatConfig: { enableAgentMode: false }, plugins: ['my-plugin'] },
        hasEnabledKnowledgeBases: true,
      }),
    );
    expect(resolved.allowExplicitActivation).toBe(false);
    expect(resolved.rules['my-plugin']).toBeUndefined();
    expect(resolved.rules['lobe-agent']).toBeUndefined();
    expect(resolved.rules['lobe-knowledge-base']).toBe(true);
    expect(resolved.rules['lobe-web-browsing']).toBe(true);
    expect(resolved.defaultToolIds).not.toContain('lobe-agent');
  });

  it('custom mode is exactly the pinned plugins', () => {
    const resolved = resolveToolRules(
      request({ agent: { chatConfig: { toolMode: 'custom' }, plugins: ['a', 'b'] } }),
    );
    expect(resolved.rules).toEqual({ a: true, b: true });
    expect(resolved.defaultToolIds).toEqual(['a', 'b']);
    expect(resolved.allowExplicitActivation).toBe(false);
  });

  it('agent mode enables pinned, runtime and always-on tools and opens the activator', () => {
    const resolved = resolveToolRules(
      request({ isGroupSupervisor: true, runtimePluginIds: ['scope-plugin'] }),
    );
    expect(resolved.allowExplicitActivation).toBe(true);
    expect(resolved.rules['my-plugin']).toBe(true);
    expect(resolved.rules['scope-plugin']).toBe(true);
    expect(resolved.rules['lobe-agent']).toBe(true);
    for (const id of groupSupervisorToolIds) {
      expect(resolved.rules[id]).toBe(true);
      expect(resolved.defaultToolIds).toContain(id);
    }
  });

  it('offers image generation only when pinned on a tool-calling model without native output', () => {
    const pinned = { chatConfig: { enableAgentMode: false }, plugins: ['lobe-image-generation'] };
    expect(resolveToolRules(request({ agent: pinned })).rules['lobe-image-generation']).toBe(true);
    expect(
      resolveToolRules(request({ agent: pinned, model: { canUseFC: true, hasImageOutput: true } }))
        .rules['lobe-image-generation'],
    ).toBe(false);
    expect(
      resolveToolRules(request({ agent: pinned, model: { canUseFC: false } })).rules[
        'lobe-image-generation'
      ],
    ).toBe(false);
  });

  it('gates the sandbox, local and device tools on the execution target', () => {
    const sandbox = resolveToolRules(request({ executionTarget: 'sandbox' }));
    expect(sandbox.rules['lobe-cloud-sandbox']).toBe(true);
    expect(sandbox.rules['lobe-local-system']).toBe(false);

    const auto = resolveToolRules(request({ executionTarget: 'auto' }));
    expect(auto.rules['lobe-cloud-sandbox']).toBe(true);

    const localNotReady = resolveToolRules(request({ executionTarget: 'local' }));
    expect(localNotReady.rules['lobe-local-system']).toBe(false);
    expect(localNotReady.rules['lobe-browser']).toBe(false);

    const localReady = resolveToolRules(
      request({ executionTarget: 'local', localExecutionReady: true }),
    );
    expect(localReady.rules['lobe-local-system']).toBe(true);
    expect(localReady.rules['lobe-browser']).toBe(true);
    expect(localReady.rules['lobe-cloud-sandbox']).toBe(false);

    const disabledLocal = resolveToolRules(
      request({ disableLocalSystem: true, executionTarget: 'local', localExecutionReady: true }),
    );
    expect(disabledLocal.rules['lobe-local-system']).toBe(false);
  });

  it('offers the device picker only behind a gateway while a device decision remains', () => {
    const noGateway = resolveToolRules(request({ executionTarget: 'device' }));
    expect(noGateway.rules['lobe-remote-device']).toBe(false);
    expect(noGateway.excludedIdentifiers).toEqual(new Set());

    const open = resolveToolRules(
      request({ device: { canUseDevice: true, deviceLocked: false }, executionTarget: 'device' }),
    );
    expect(open.rules['lobe-remote-device']).toBe(true);

    const locked = resolveToolRules(
      request({ device: { canUseDevice: true, deviceLocked: true }, executionTarget: 'device' }),
    );
    expect(locked.rules['lobe-remote-device']).toBe(false);
    expect(locked.excludedIdentifiers.has('lobe-remote-device')).toBe(true);
    expect(locked.excludedIdentifiers.has('lobe-local-system')).toBe(false);
  });

  it('walls every device tool off for a run whose policy denies devices', () => {
    const denied = resolveToolRules(
      request({
        device: {
          canUseDevice: false,
          deviceLocked: false,
          supportedTools: [AuvManifest.identifier],
        },
        disabledPluginIds: ['my-plugin'],
        executionTarget: 'none',
      }),
    );
    expect(denied.excludedIdentifiers).toEqual(
      new Set([
        'my-plugin',
        'lobe-local-system',
        'lobe-remote-device',
        'lobe-browser',
        AuvManifest.identifier,
      ]),
    );
    // Computer Use also disappears when the routed device does not support it.
    const unsupported = resolveToolRules(
      request({ device: { canUseDevice: true, deviceLocked: false }, executionTarget: 'local' }),
    );
    expect(unsupported.excludedIdentifiers.has(AuvManifest.identifier)).toBe(true);
  });

  it('enables the message tool in bot conversations and search per the decision', () => {
    const bot = resolveToolRules(
      request({ isBotConversation: true, useApplicationBuiltinSearchTool: false }),
    );
    expect(bot.rules['lobe-message']).toBe(true);
    expect(bot.rules['lobe-web-browsing']).toBe(false);
    const off = resolveToolRules(request({ agent: { chatConfig: { searchMode: 'off' } } }));
    expect(off.rules['lobe-web-browsing']).toBe(false);
  });
});

describe('filterAllowedBuiltinTools', () => {
  const tools = [
    { identifier: 'lobe-local-system' },
    { identifier: 'lobe-remote-device' },
    { identifier: AuvManifest.identifier },
    { identifier: 'lobe-web-browsing' },
  ];
  it('keeps non-device tools and drops device tools per the walls', () => {
    const ids = (params: Parameters<typeof filterAllowedBuiltinTools>[1]) =>
      filterAllowedBuiltinTools(tools, params).map((t) => t.identifier);
    expect(ids({ canUseDevice: false, deviceLocked: false })).toEqual(['lobe-web-browsing']);
    expect(ids({ canUseDevice: true, deviceLocked: true })).toEqual([
      'lobe-local-system',
      AuvManifest.identifier,
      'lobe-web-browsing',
    ]);
    expect(ids({ canUseDevice: true, deviceLocked: false, supportedDeviceTools: [] })).toEqual([
      'lobe-local-system',
      'lobe-remote-device',
      'lobe-web-browsing',
    ]);
    expect(ids({ canUseDevice: true, deviceLocked: false, disableLocalSystem: true })).toEqual([
      'lobe-remote-device',
      'lobe-web-browsing',
    ]);
  });
});
