import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  devicePoolForAgent,
  devicePoolForTask,
  executionTargetValue,
  findOwnWorkspaceDevice,
  getMachineDefaultTarget,
  groupExecutionTargetDevices,
  isSharedExecutionTarget,
  parseExecutionTargetValue,
  resolveExecutionTargetSelection,
} from './index';

const device = (overrides: Partial<DeviceListItem>): DeviceListItem =>
  ({
    channels: [],
    defaultCwd: null,
    deviceId: 'device',
    enroller: null,
    friendlyName: null,
    hostname: null,
    identitySource: null,
    lastSeen: '',
    online: false,
    platform: null,
    registered: true,
    scope: 'personal',
    visibility: null,
    workingDirs: [],
    ...overrides,
  }) as DeviceListItem;

describe('ExecutionTargetPicker helpers', () => {
  it('round-trips shared targets and device ids', () => {
    expect(parseExecutionTargetValue(executionTargetValue('sandbox'))).toEqual({
      target: 'sandbox',
    });
    expect(parseExecutionTargetValue(executionTargetValue('device', 'workspace-device'))).toEqual({
      deviceId: 'workspace-device',
      target: 'device',
    });
  });

  it('separates personal, private workspace, and public workspace devices', () => {
    const personal = device({ deviceId: 'personal' });
    const privateWorkspace = device({
      deviceId: 'private',
      scope: 'workspace',
      visibility: 'private',
    });
    const publicWorkspace = device({
      deviceId: 'public',
      scope: 'workspace',
      visibility: 'public',
    });

    expect(groupExecutionTargetDevices([personal, privateWorkspace, publicWorkspace])).toEqual({
      personal: [personal],
      privateWorkspace: [privateWorkspace],
      publicWorkspace: [publicWorkspace],
      workspace: [publicWorkspace],
    });
  });

  describe('resolveExecutionTargetSelection', () => {
    const publicDevice = device({
      deviceId: 'public',
      scope: 'workspace',
      visibility: 'public',
    });

    it('resolves a bound device only while that device is still reachable', () => {
      expect(
        resolveExecutionTargetSelection({
          boundDeviceId: 'public',
          configuredTarget: 'device',
          devices: [publicDevice],
          isHeterogeneous: true,
        }),
      ).toEqual({ deviceId: 'public', target: 'device' });

      // Device unshared / deleted / list still loading — there is nothing to fix.
      expect(
        resolveExecutionTargetSelection({
          boundDeviceId: 'public',
          configuredTarget: 'device',
          devices: [],
          isHeterogeneous: true,
        }),
      ).toBeUndefined();
    });

    it('falls back to "none" only for built-in-runtime agents with nothing stored', () => {
      expect(resolveExecutionTargetSelection({ devices: [], isHeterogeneous: false })).toEqual({
        target: 'none',
      });
      expect(
        resolveExecutionTargetSelection({ devices: [], isHeterogeneous: true }),
      ).toBeUndefined();
    });

    it('passes through a stored shared target', () => {
      expect(
        resolveExecutionTargetSelection({
          configuredTarget: 'sandbox',
          devices: [],
          isHeterogeneous: true,
        }),
      ).toEqual({ target: 'sandbox' });
    });
  });

  it('allows only server-resolvable targets as shared defaults', () => {
    expect(isSharedExecutionTarget('none')).toBe(true);
    expect(isSharedExecutionTarget('auto')).toBe(true);
    expect(isSharedExecutionTarget('sandbox')).toBe(true);
    expect(isSharedExecutionTarget('device')).toBe(true);
    expect(isSharedExecutionTarget('local')).toBe(false);
  });
});

describe('devicePoolForAgent', () => {
  const personal = device({ deviceId: 'personal' });
  const privateWorkspace = device({
    deviceId: 'private',
    scope: 'workspace',
    visibility: 'private',
  });
  const publicWorkspace = device({ deviceId: 'public', scope: 'workspace', visibility: 'public' });
  const all = [personal, privateWorkspace, publicWorkspace];

  it('gives a workspace agent the whole workspace pool, private rows first', () => {
    // Both pools are keyed by the identity they were enrolled under
    // (`sha256(machineUUID + userId)` vs `… + workspace:<id>`), so a workspace
    // run can only resolve the workspace rows — and it resolves every one of
    // them, whoever enrolled the machine.
    expect(devicePoolForAgent(all, true)).toEqual([privateWorkspace, publicWorkspace]);
  });

  it('gives an agent outside a workspace the caller’s personal machines', () => {
    expect(devicePoolForAgent(all, false)).toEqual([personal]);
  });

  it('survives an unloaded list', () => {
    expect(devicePoolForAgent(undefined, true)).toEqual([]);
    expect(devicePoolForAgent(undefined, false)).toEqual([]);
  });

  it('lets the task creator pin their own private devices too', () => {
    const asCreator = { includeOwnPrivate: true };
    expect(devicePoolForTask(all, true, asCreator)).toEqual([privateWorkspace, publicWorkspace]);
    expect(devicePoolForTask(all, false, asCreator)).toEqual([personal]);
    expect(devicePoolForTask(undefined, true, asCreator)).toEqual([]);
  });

  // The creator's scheduled runs cannot resolve a collaborator's private row.
  it('gives a collaborator on someone else’s task only the public workspace pool', () => {
    const asCollaborator = { includeOwnPrivate: false };
    expect(devicePoolForTask(all, true, asCollaborator)).toEqual([publicWorkspace]);
    expect(devicePoolForTask(all, false, asCollaborator)).toEqual([personal]);
  });
});

describe('findOwnWorkspaceDevice', () => {
  const personal = device({ deviceId: 'personal-id' });
  const own = device({ deviceId: 'ws-id', scope: 'workspace', visibility: 'private' });
  const other = device({ deviceId: 'other', scope: 'workspace', visibility: 'public' });

  it('ignores this machine’s row when it is shared as public', () => {
    const ownPublic = device({ deviceId: 'ws-id', scope: 'workspace', visibility: 'public' });
    expect(findOwnWorkspaceDevice([personal, ownPublic], ['personal-id', 'ws-id'])).toBeUndefined();
  });

  it('finds this machine’s workspace row, never its personal one', () => {
    expect(findOwnWorkspaceDevice([personal, own, other], ['personal-id', 'ws-id'])).toBe(own);
    expect(findOwnWorkspaceDevice([personal, other], ['personal-id', 'ws-id'])).toBeUndefined();
    expect(findOwnWorkspaceDevice(undefined, ['personal-id'])).toBeUndefined();
  });
});

describe('getMachineDefaultTarget', () => {
  it('defaults an unset agent to this machine’s workspace row when it has one', () => {
    expect(
      getMachineDefaultTarget({
        isOwnPick: true,
        localSandboxEnabled: false,
        ownWorkspaceDeviceId: 'ws-id',
      }),
    ).toEqual({ deviceId: 'ws-id', target: 'device' });
  });

  it('defaults an unset agent to local without a workspace row', () => {
    expect(getMachineDefaultTarget({ isOwnPick: true, localSandboxEnabled: false })).toEqual({
      target: 'local',
    });
  });

  it('moves a plain local pick onto the workspace row', () => {
    expect(
      getMachineDefaultTarget({
        boundDeviceId: 'personal-id',
        executionTarget: 'local',
        isOwnPick: true,
        localSandboxEnabled: false,
        ownWorkspaceDeviceId: 'ws-id',
      }),
    ).toEqual({ deviceId: 'ws-id', target: 'device' });
  });

  it('keeps a sandboxed local pick, and any other explicit pick', () => {
    expect(
      getMachineDefaultTarget({
        executionTarget: 'local',
        isOwnPick: true,
        localSandboxEnabled: true,
        ownWorkspaceDeviceId: 'ws-id',
      }),
    ).toBeUndefined();
    expect(
      getMachineDefaultTarget({
        executionTarget: 'sandbox',
        isOwnPick: true,
        localSandboxEnabled: false,
        ownWorkspaceDeviceId: 'ws-id',
      }),
    ).toBeUndefined();
    expect(
      getMachineDefaultTarget({
        executionTarget: 'local',
        isOwnPick: true,
        localSandboxEnabled: false,
      }),
    ).toBeUndefined();
  });

  // A legacy shared `local` routes every member to its bound workspace device;
  // a member who only inherits it must keep following the agent.
  it('leaves an inherited shared local alone', () => {
    expect(
      getMachineDefaultTarget({
        boundDeviceId: 'shared-ws-device',
        executionTarget: 'local',
        isOwnPick: false,
        localSandboxEnabled: false,
        ownWorkspaceDeviceId: 'ws-id',
      }),
    ).toBeUndefined();
  });
});
