import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ChannelAgentEnvironment } from './agentEnvironment';
import {
  canSubmitChannelAgents,
  changeChannelAgentDevice,
  createChannelAgentSelection,
  getChannelAgentIssue,
  reconcileChannelAgentDraft,
  toChannelAgentSelection,
} from './agentEnvironment';

const device = (deviceId: string, extra: Partial<DeviceListItem> = {}): DeviceListItem => ({
  channels: [],
  defaultCwd: null,
  deviceId,
  enroller: null,
  friendlyName: null,
  hostname: deviceId,
  identitySource: null,
  lastSeen: '',
  online: true,
  platform: 'darwin',
  registered: true,
  scope: 'personal',
  ...extra,
});

const environment = (extra: Partial<ChannelAgentEnvironment> = {}): ChannelAgentEnvironment => ({
  agencyConfig: {
    boundDeviceId: 'bound',
    executionTarget: 'device',
    heterogeneousProvider: { type: 'pi' },
    workingDirByDevice: { bound: '/agent-project', other: '/other-project' },
  },
  currentDeviceId: 'current',
  devices: [device('bound'), device('current'), device('other')],
  devicesConfirmed: true,
  isDesktop: true,
  ...extra,
});

describe('Channel Agent environment defaults', () => {
  it('inherits the connected Agent device and its working directory', () => {
    expect(createChannelAgentSelection('pi', environment())).toEqual({
      agentId: 'pi',
      deviceId: 'bound',
      workingDirectory: '/agent-project',
    });
  });

  it('resolves a desktop-local Agent without choosing an unrelated online device', () => {
    const env = environment({ agencyConfig: { heterogeneousProvider: { type: 'codex' } } });
    expect(createChannelAgentSelection('codex', env)).toEqual({
      agentId: 'codex',
      deviceId: 'current',
      workingDirectory: undefined,
    });
    expect(
      createChannelAgentSelection('codex', { ...env, isDesktop: false }).deviceId,
    ).toBeUndefined();
    expect(
      createChannelAgentSelection('codex', { ...env, workspaceScoped: true }).deviceId,
    ).toBeUndefined();
  });

  it('keeps an explicitly bound local device rather than switching to this machine', () => {
    const env = environment();
    env.agencyConfig!.executionTarget = 'local';
    expect(createChannelAgentSelection('pi', env).deviceId).toBe('bound');
  });

  it.each(['none', 'sandbox', 'auto'] as const)(
    'does not turn %s into an arbitrary device',
    (executionTarget) => {
      const env = environment();
      env.agencyConfig!.executionTarget = executionTarget;
      expect(createChannelAgentSelection('pi', env).deviceId).toBeUndefined();
    },
  );

  it('keeps Native Agents without a device when none was configured', () => {
    const env = environment({ agencyConfig: undefined, model: 'gpt-4o' });
    const selection = createChannelAgentSelection('native', env);
    expect(selection).toEqual({ agentId: 'native' });
    expect(getChannelAgentIssue(selection, env)).toBeUndefined();
  });

  it('uses a same-device active worktree, then a same-device default directory', () => {
    const env = environment();
    env.agencyConfig!.workingDirByDevice = {
      bound: { path: '/repo', git: { activeWorktree: '/worktrees/topic', isWorktree: true } },
    };
    expect(createChannelAgentSelection('pi', env).workingDirectory).toBe('/worktrees/topic');
    env.agencyConfig!.workingDirByDevice = { other: '/wrong-device' };
    env.devices = [device('bound', { defaultCwd: '/device-default' })];
    expect(createChannelAgentSelection('pi', env).workingDirectory).toBe('/device-default');
  });

  it('preserves an offline or missing binding for an explicit recovery, without falling back', () => {
    for (const devices of [
      [device('bound', { online: false }), device('other')],
      [device('other')],
    ]) {
      expect(createChannelAgentSelection('pi', environment({ devices })).deviceId).toBe('bound');
    }
  });

  it('device changes use only the new device directory and never mutate the Agent defaults', () => {
    const env = environment();
    const original = structuredClone(env.agencyConfig);
    const selected = { agentId: 'pi', deviceId: 'bound', workingDirectory: '/channel-override' };
    expect(changeChannelAgentDevice(selected, 'other', env).workingDirectory).toBe(
      '/other-project',
    );
    expect(changeChannelAgentDevice(selected, 'current', env).workingDirectory).toBeUndefined();
    expect(changeChannelAgentDevice(selected, undefined, env).workingDirectory).toBeUndefined();
    expect(env.agencyConfig).toEqual(original);
    expect(selected.workingDirectory).toBe('/channel-override');
  });
});

describe('Channel form hydration', () => {
  it('waits for settings and confirmed device data before snapshotting defaults', () => {
    const draft = { agentId: 'pi', initialized: false };
    const pending = reconcileChannelAgentDraft(draft, environment(), 'configurationLoading');
    expect(pending.initialized).toBe(false);
    expect(pending.issue).toBe('configurationLoading');
    const devicesPending = reconcileChannelAgentDraft(
      draft,
      environment({ devicesConfirmed: false }),
    );
    expect(devicesPending.initialized).toBe(false);
    expect(devicesPending.issue).toBe('devicesLoading');
    const ready = reconcileChannelAgentDraft(devicesPending, environment());
    expect(ready).toEqual({
      agentId: 'pi',
      deviceId: 'bound',
      workingDirectory: '/agent-project',
      initialized: true,
      issue: undefined,
    });
  });

  it('leaves a failed settings read retryable, not a usable blank selection', () => {
    const draft = reconcileChannelAgentDraft(
      { agentId: 'pi', initialized: false },
      environment(),
      'configurationFailed',
    );
    expect(canSubmitChannelAgents([draft])).toBe(false);
    expect(draft.issue).toBe('configurationFailed');
    expect(reconcileChannelAgentDraft(draft, environment()).deviceId).toBe('bound');
  });

  it('never overwrites channel edits or an explicit cleared device on refresh', () => {
    const env = environment();
    const edited = {
      agentId: 'pi',
      deviceId: 'other',
      workingDirectory: '/channel-only',
      initialized: true,
    };
    expect(reconcileChannelAgentDraft(edited, env)).toBe(edited);
    const cleared = { agentId: 'pi', initialized: true };
    expect(reconcileChannelAgentDraft(cleared, env)).toEqual({
      ...cleared,
      issue: 'deviceRequired',
    });
    expect(env.agencyConfig?.workingDirByDevice?.bound).toBe('/agent-project');
  });

  it('reacts to a selected device going offline without losing its directory', () => {
    const ready = reconcileChannelAgentDraft({ agentId: 'pi', initialized: false }, environment());
    const offline = reconcileChannelAgentDraft(
      ready,
      environment({ devices: [device('bound', { online: false })] }),
    );
    expect(offline.issue).toBe('deviceOffline');
    expect(offline.workingDirectory).toBe('/agent-project');
    expect(canSubmitChannelAgents([offline])).toBe(false);
    expect(canSubmitChannelAgents([reconcileChannelAgentDraft(offline, environment())])).toBe(true);
  });

  it('does not let a device-list outage prevent a device-free Native Agent', () => {
    const native = reconcileChannelAgentDraft(
      { agentId: 'native', initialized: false },
      environment({
        agencyConfig: undefined,
        devices: undefined,
        devicesConfirmed: false,
        devicesError: new Error('offline'),
      }),
    );
    expect(canSubmitChannelAgents([native])).toBe(true);
  });
});

describe('Channel Agent submission guard', () => {
  it('requires a device for Pi and legacy heterogeneous model IDs', () => {
    expect(getChannelAgentIssue({ agentId: 'pi' }, environment())).toBe('deviceRequired');
    expect(
      getChannelAgentIssue(
        { agentId: 'codex' },
        environment({ agencyConfig: undefined, model: 'codex' }),
      ),
    ).toBe('deviceRequired');
  });

  it('requires a nonblank directory, including for a Native Agent with a device', () => {
    for (const workingDirectory of [undefined, '', '  ']) {
      expect(
        getChannelAgentIssue(
          { agentId: 'native', deviceId: 'bound', workingDirectory },
          environment({ agencyConfig: undefined }),
        ),
      ).toBe('directoryRequired');
    }
  });

  it.each([
    [{ devicesConfirmed: false }, 'devicesLoading'],
    [{ devicesError: new Error('refresh failed') }, 'devicesFailed'],
    [{ devices: [] }, 'deviceUnavailable'],
    [{ devices: [device('bound', { online: false })] }, 'deviceOffline'],
    [{ devices: [device('bound', { onlineUnknown: true })] }, 'devicesLoading'],
    [
      { devices: [device('bound', { scope: 'workspace', visibility: 'private' })] },
      'deviceUnavailable',
    ],
  ] as const)('blocks unsafe device state %o', (patch, issue) => {
    const env = environment({
      ...patch,
      ...('devices' in patch ? { devices: [...patch.devices] } : {}),
    });
    expect(
      getChannelAgentIssue({ agentId: 'pi', deviceId: 'bound', workingDirectory: '/project' }, env),
    ).toBe(issue);
  });

  it('allows a fully configured Agent and prevents pending/invalid/empty submissions', () => {
    const selection = createChannelAgentSelection('pi', environment());
    expect(getChannelAgentIssue(selection, environment())).toBeUndefined();
    expect(canSubmitChannelAgents([])).toBe(false);
    expect(canSubmitChannelAgents([{ ...selection, initialized: false }])).toBe(false);
    expect(
      canSubmitChannelAgents([{ ...selection, initialized: true, issue: 'deviceRequired' }]),
    ).toBe(false);
    expect(canSubmitChannelAgents([{ ...selection, initialized: true }])).toBe(true);
    expect(toChannelAgentSelection({ ...selection, initialized: true, issue: undefined })).toEqual(
      selection,
    );
  });
});
