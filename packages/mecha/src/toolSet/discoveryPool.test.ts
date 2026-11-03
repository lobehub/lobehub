import {
  AgentManagementManifest,
  resolveAgentManagementManifest,
} from '@lobechat/builtin-tool-agent-management';
import { AuvManifest } from '@lobechat/builtin-tool-auv';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import {
  type DiscoveryPoolRequest,
  resolveClientExecutors,
  resolveDiscoveryPool,
  resolveInvocationToolIds,
} from './discoveryPool';

const manifest = (identifier: string, extra: Record<string, unknown> = {}): LobeToolManifest =>
  ({ api: [], identifier, meta: {}, ...extra }) as LobeToolManifest;

const builtin = (identifier: string, discoverable?: boolean) => ({
  discoverable,
  identifier,
  manifest: manifest(identifier) as never,
});

const request = (overrides: Partial<DiscoveryPoolRequest> = {}): DiscoveryPoolRequest => ({
  builtinTools: [
    builtin('lobe-creds'),
    builtin('lobe-infra', false),
    builtin(CloudSandboxManifest.identifier),
    builtin(RemoteDeviceManifest.identifier),
  ],
  enabledManifests: new Map([['my-plugin', manifest('my-plugin')]]),
  executionTarget: 'sandbox',
  ...overrides,
});

describe('resolveInvocationToolIds', () => {
  it('adds the device tools and every connector family to the agent candidates', () => {
    const ids = resolveInvocationToolIds({
      agentPlugins: ['a'],
      composioIds: ['gmail'],
      connectorIds: ['notion'],
      lobehubSkillIds: ['linear'],
    });
    expect(ids).toEqual([
      'a',
      LocalSystemManifest.identifier,
      AuvManifest.identifier,
      RemoteDeviceManifest.identifier,
      'linear',
      'gmail',
      'notion',
    ]);
  });

  it('adds nothing to an exclusive set and skips local tools when disabled', () => {
    expect(
      resolveInvocationToolIds({ agentPlugins: ['only'], exclusivePluginIds: ['only'] }),
    ).toEqual(['only']);
    expect(resolveInvocationToolIds({ agentPlugins: [], disableLocalSystem: true })).toEqual([
      RemoteDeviceManifest.identifier,
    ]);
  });
});

describe('resolveDiscoveryPool', () => {
  it('seeds with the enabled manifests and appends discoverable builtins only', () => {
    const pool = resolveDiscoveryPool(request());
    expect(Object.keys(pool.manifestMap)).toEqual([
      'my-plugin',
      'lobe-creds',
      CloudSandboxManifest.identifier,
      RemoteDeviceManifest.identifier,
    ]);
  });

  it('keeps the sandbox only when reachable and drops device tools for a non-device gateway run', () => {
    const none = resolveDiscoveryPool(
      request({
        device: {},
        enabledManifests: new Map([
          [CloudSandboxManifest.identifier, manifest(CloudSandboxManifest.identifier)],
          [LocalSystemManifest.identifier, manifest(LocalSystemManifest.identifier)],
        ]),
        executionTarget: 'none',
      }),
    );
    expect(none.manifestMap[CloudSandboxManifest.identifier]).toBeUndefined();
    expect(none.manifestMap[LocalSystemManifest.identifier]).toBeUndefined();
    expect(none.manifestMap[RemoteDeviceManifest.identifier]).toBeUndefined();

    const auto = resolveDiscoveryPool(request({ device: {}, executionTarget: 'auto' }));
    expect(auto.manifestMap[CloudSandboxManifest.identifier]).toBeDefined();
  });

  it('keeps the picker discoverable for a device-capable run that is not routed yet', () => {
    // `auto` with several machines online: unrouted, and the picker is
    // exactly what resolves it.
    const unrouted = resolveDiscoveryPool(
      request({
        device: {},
        deviceAccess: { canUseDevice: true, deviceLocked: false },
        deviceCapable: true,
        enabledManifests: new Map([
          [RemoteDeviceManifest.identifier, manifest(RemoteDeviceManifest.identifier)],
        ]),
        executionTarget: 'auto',
      }),
    );
    expect(unrouted.manifestMap[RemoteDeviceManifest.identifier]).toBeDefined();
  });

  it('injects local-system and Computer Use for a local target behind a gateway', () => {
    const local = resolveDiscoveryPool(
      request({
        device: { supportedTools: [AuvManifest.identifier] },
        deviceAccess: { canUseDevice: true, deviceLocked: false },
        deviceCapable: true,
        executionTarget: 'local',
      }),
    );
    expect(local.manifestMap[LocalSystemManifest.identifier]).toBeDefined();
    expect(local.manifestMap[AuvManifest.identifier]).toBeDefined();

    // An older device that does not report Computer Use never sees it.
    const older = resolveDiscoveryPool(
      request({
        device: { supportedTools: [] },
        deviceAccess: { canUseDevice: true, deviceLocked: false },
        deviceCapable: true,
        executionTarget: 'local',
      }),
    );
    expect(older.manifestMap[AuvManifest.identifier]).toBeUndefined();
    expect(older.manifestMap[LocalSystemManifest.identifier]).toBeDefined();
  });

  it('walls every ingest source: exclusive set, disabled ids, denied devices, locked picker', () => {
    const exclusive = resolveDiscoveryPool(
      request({ exclusivePluginIds: ['my-plugin'], lobehubSkills: [manifest('linear')] }),
    );
    expect(Object.keys(exclusive.manifestMap)).toEqual(['my-plugin']);

    const denied = resolveDiscoveryPool(
      request({
        deviceAccess: { canUseDevice: false, deviceLocked: false },
        deviceCapable: true,
        disabledPluginIds: ['my-plugin'],
        executionTarget: 'local',
        lobehubSkills: [manifest(RemoteDeviceManifest.identifier)],
      }),
    );
    expect(denied.manifestMap['my-plugin']).toBeUndefined();
    expect(denied.manifestMap[RemoteDeviceManifest.identifier]).toBeUndefined();
    expect(denied.sourceMap[RemoteDeviceManifest.identifier]).toBeUndefined();

    const locked = resolveDiscoveryPool(
      request({
        device: {},
        deviceAccess: { canUseDevice: true, deviceLocked: true },
        deviceCapable: true,
        executionTarget: 'device',
      }),
    );
    expect(locked.manifestMap[RemoteDeviceManifest.identifier]).toBeUndefined();
  });

  it('records the family a connector tool executes through', () => {
    const pool = resolveDiscoveryPool(
      request({ composio: [manifest('gmail')], lobehubSkills: [manifest('linear')] }),
    );
    expect(pool.sourceMap).toEqual({ gmail: 'composio', linear: 'lobehubSkill' });
    expect(pool.manifestMap.gmail).toBeDefined();
  });

  describe('installed-but-not-pinned plugins', () => {
    // `auto` in the agent's three-state plugin config: installed at the user
    // level, absent from `agent.plugins`, not disabled. The client runtime
    // lists these in `<available_tools>`; the gateway must not diverge.
    const installed = (identifier: string) =>
      manifest(identifier, { meta: { title: identifier }, type: 'mcp' });

    it('seeds them as discoverable, without touching the enabled set', () => {
      const pool = resolveDiscoveryPool(
        request({
          builtinTools: [],
          enabledManifests: new Map([['my-plugin', manifest('my-plugin')]]),
          installedManifests: [installed('feishu-mcp'), installed('github-mcp')],
        }),
      );

      expect(pool.manifestMap['feishu-mcp']).toBeDefined();
      expect(pool.manifestMap['github-mcp']).toBeDefined();
      // Every installed plugin executes through the MCP path.
      expect(pool.sourceMap['feishu-mcp']).toBe('mcp');

      // The source is additive: what the engine enabled is unchanged, and the
      // pool carries no notion of "enabled" of its own — `enabledToolIds` is
      // computed elsewhere from the rules.
      expect(Object.keys(pool.manifestMap)).toEqual(['my-plugin', 'feishu-mcp', 'github-mcp']);
    });

    it('never overrides an identifier another source already answered for', () => {
      // A pinned plugin keeps the engine's manifest (and so keeps its own
      // routing rather than being relabelled as a fresh MCP plugin).
      const pinned = manifest('feishu-mcp', { meta: { title: 'Pinned' } });
      const pin = resolveDiscoveryPool(
        request({
          enabledManifests: new Map([['feishu-mcp', pinned]]),
          installedManifests: [installed('feishu-mcp')],
        }),
      );
      expect(pin.manifestMap['feishu-mcp']).toBe(pinned);
      expect(pin.sourceMap['feishu-mcp']).toBeUndefined();

      // A connector family outranks the same-named leftover plugin row.
      const family = resolveDiscoveryPool(
        request({ composio: [manifest('gmail')], installedManifests: [installed('gmail')] }),
      );
      expect(family.sourceMap.gmail).toBe('composio');
    });

    it('keeps every wall on the new source', () => {
      const disabled = resolveDiscoveryPool(
        request({
          disabledPluginIds: ['feishu-mcp'],
          installedManifests: [installed('feishu-mcp')],
        }),
      );
      expect(disabled.manifestMap['feishu-mcp']).toBeUndefined();
      expect(disabled.sourceMap['feishu-mcp']).toBeUndefined();

      const exclusive = resolveDiscoveryPool(
        request({
          exclusivePluginIds: ['my-plugin'],
          installedManifests: [installed('feishu-mcp')],
        }),
      );
      expect(Object.keys(exclusive.manifestMap)).toEqual(['my-plugin']);

      const noDevice = resolveDiscoveryPool(
        request({
          deviceAccess: { canUseDevice: false, deviceLocked: false },
          installedManifests: [installed(LocalSystemManifest.identifier)],
        }),
      );
      expect(noDevice.manifestMap[LocalSystemManifest.identifier]).toBeUndefined();
    });
  });

  describe('context-aware builtin manifests', () => {
    const agentManagement = {
      identifier: AgentManagementManifest.identifier,
      manifest: AgentManagementManifest,
      resolveManifest: resolveAgentManagementManifest,
    };
    const apiNames = (m?: LobeToolManifest) => m?.api.map((api) => api.name);

    it('resolves a discoverable builtin for the run, so a sub-agent cannot activate callAgent', () => {
      const pool = resolveDiscoveryPool(
        request({ builtinTools: [agentManagement], manifestContext: { isSubAgent: true } }),
      );

      const discovered = pool.manifestMap[AgentManagementManifest.identifier];
      expect(apiNames(discovered)).not.toContain('callAgent');
      expect(apiNames(discovered)).toContain('getAgentDetail');
      expect(discovered.systemRole).toContain('Dispatching work to other agents is not available');
    });

    it('keeps callAgent discoverable in a top-level run', () => {
      const pool = resolveDiscoveryPool(
        request({ builtinTools: [agentManagement], manifestContext: { isSubAgent: false } }),
      );
      expect(apiNames(pool.manifestMap[AgentManagementManifest.identifier])).toContain('callAgent');
    });

    it('drops a builtin whose resolver opts out of the run', () => {
      const pool = resolveDiscoveryPool(
        request({
          builtinTools: [{ ...builtin('lobe-opt-out'), resolveManifest: () => null }],
          manifestContext: {},
        }),
      );
      expect(pool.manifestMap['lobe-opt-out']).toBeUndefined();
    });
  });
});

describe('resolveClientExecutors', () => {
  const manifestMap = {
    'local': manifest('local', { executors: ['client'] }),
    'server': manifest('server'),
    'stdio-mcp': manifest('stdio-mcp', { type: 'mcp' }),
  };

  it('marks client-executed and stdio tools only without a gateway', () => {
    expect(
      resolveClientExecutors({
        hasDeviceProxy: false,
        manifestMap,
        stdioIdentifiers: ['stdio-mcp', 'no-manifest'],
      }),
    ).toEqual({ 'local': 'client', 'stdio-mcp': 'client' });

    // With a gateway the executor stays unset: every caller converges on the
    // device-gateway route, and marking the client here would bypass it.
    expect(
      resolveClientExecutors({
        hasDeviceProxy: true,
        manifestMap,
        stdioIdentifiers: ['stdio-mcp'],
      }),
    ).toEqual({});
  });

  it('marks a stdio plugin that is only discoverable, not enabled', () => {
    // The activator can enable `stdio-mcp` mid-run. `ToolResolver` copies this
    // map into the operation snapshot and `applyActivation` never revisits it,
    // so an id left out here would be dispatched to the server — running the
    // user's local MCP command there instead of on their machine.
    expect(
      resolveClientExecutors({
        hasDeviceProxy: false,
        manifestMap: { 'stdio-mcp': manifestMap['stdio-mcp'] },
        stdioIdentifiers: ['stdio-mcp'],
      }),
    ).toEqual({ 'stdio-mcp': 'client' });
  });

  it('never marks a plugin that is not stdio', () => {
    // An http MCP plugin in the same pool keeps running through the server's
    // MCP path; only the stdio list is client-executed.
    expect(
      resolveClientExecutors({
        hasDeviceProxy: false,
        manifestMap: { 'http-mcp': manifest('http-mcp', { type: 'mcp' }) },
        stdioIdentifiers: [],
      }),
    ).toEqual({});
  });
});
