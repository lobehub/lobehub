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
});

describe('resolveClientExecutors', () => {
  it('marks client-executed and stdio tools only without a gateway', () => {
    const manifestMap = {
      'local': manifest('local', { executors: ['client'] }),
      'server': manifest('server'),
      'stdio-mcp': manifest('stdio-mcp'),
    };
    expect(
      resolveClientExecutors({
        enabledIds: new Set(['stdio-mcp']),
        hasDeviceProxy: false,
        manifestMap,
        stdioIdentifiers: ['stdio-mcp', 'not-enabled'],
      }),
    ).toEqual({ 'local': 'client', 'stdio-mcp': 'client' });
    expect(
      resolveClientExecutors({ enabledIds: new Set(), hasDeviceProxy: true, manifestMap }),
    ).toEqual({});
  });
});
