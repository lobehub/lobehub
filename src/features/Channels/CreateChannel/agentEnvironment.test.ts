import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ChannelAgentEnvironment } from './agentEnvironment';
import {
  canSubmitChannelAgents,
  canSubmitChannelMembers,
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
  devices: [device('bound'), device('current'), device('other')],
  devicesConfirmed: true,
  ...extra,
});

// A Channel binds no device by default: an Agent without a picked device runs where its own
// settings say, as in an ordinary conversation.
describe('Channel Agent environment defaults', () => {
  it.each([
    ['an Agent bound to a device', environment()],
    [
      'a desktop-local coding Agent',
      environment({ agencyConfig: { heterogeneousProvider: { type: 'codex' } } }),
    ],
    ['a Native Agent', environment({ agencyConfig: undefined, model: 'gpt-4o' })],
  ])('picks no device for %s', (_, env) => {
    const selection = createChannelAgentSelection('agent');
    expect(selection).toEqual({ agentId: 'agent' });
    expect(getChannelAgentIssue(selection, env)).toBeUndefined();
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

  it('uses a same-device active worktree, then a same-device default directory, on a pick', () => {
    const env = environment();
    env.agencyConfig!.workingDirByDevice = {
      bound: { path: '/repo', git: { activeWorktree: '/worktrees/topic', isWorktree: true } },
    };
    expect(changeChannelAgentDevice({ agentId: 'pi' }, 'bound', env).workingDirectory).toBe(
      '/worktrees/topic',
    );
    env.agencyConfig!.workingDirByDevice = { other: '/wrong-device' };
    env.devices = [device('bound', { defaultCwd: '/device-default' })];
    expect(changeChannelAgentDevice({ agentId: 'pi' }, 'bound', env).workingDirectory).toBe(
      '/device-default',
    );
  });
});

describe('Channel form hydration', () => {
  it('waits for the Agent settings, not the device list, before it is ready', () => {
    const draft = { agentId: 'pi', initialized: false };
    const pending = reconcileChannelAgentDraft(draft, environment(), 'configurationLoading');
    expect(pending.initialized).toBe(false);
    expect(pending.issue).toBe('configurationLoading');
    const ready = reconcileChannelAgentDraft(draft, environment({ devicesConfirmed: false }));
    expect(ready).toEqual({ agentId: 'pi', initialized: true, issue: undefined });
    expect(canSubmitChannelAgents([ready])).toBe(true);
  });

  it('leaves a failed settings read retryable, not a usable blank selection', () => {
    const draft = reconcileChannelAgentDraft(
      { agentId: 'pi', initialized: false },
      environment(),
      'configurationFailed',
    );
    expect(canSubmitChannelAgents([draft])).toBe(false);
    expect(draft.issue).toBe('configurationFailed');
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
    expect(reconcileChannelAgentDraft(cleared, env)).toEqual({ ...cleared, issue: undefined });
    expect(env.agencyConfig?.workingDirByDevice?.bound).toBe('/agent-project');
  });

  it('reacts to a picked device going offline without losing its directory', () => {
    const picked = {
      agentId: 'pi',
      deviceId: 'bound',
      initialized: true,
      workingDirectory: '/agent-project',
    };
    const offline = reconcileChannelAgentDraft(
      picked,
      environment({ devices: [device('bound', { online: false })] }),
    );
    expect(offline.issue).toBe('deviceOffline');
    expect(offline.workingDirectory).toBe('/agent-project');
    expect(canSubmitChannelAgents([offline])).toBe(false);
    expect(canSubmitChannelAgents([reconcileChannelAgentDraft(offline, environment())])).toBe(true);
  });

  it('does not let a device-list outage block an Agent without a picked device', () => {
    const draft = reconcileChannelAgentDraft(
      { agentId: 'pi', initialized: false },
      environment({ devices: undefined, devicesConfirmed: false, devicesError: new Error('x') }),
    );
    expect(canSubmitChannelAgents([draft])).toBe(true);
  });
});

describe('Channel Agent submission guard', () => {
  it('needs no device, for coding and Native Agents alike', () => {
    expect(getChannelAgentIssue({ agentId: 'pi' }, environment())).toBeUndefined();
    expect(
      getChannelAgentIssue(
        { agentId: 'codex' },
        environment({ agencyConfig: undefined, model: 'codex' }),
      ),
    ).toBeUndefined();
  });

  it('requires a nonblank directory on a picked device', () => {
    for (const workingDirectory of [undefined, '', '  ']) {
      expect(
        getChannelAgentIssue(
          { agentId: 'native', deviceId: 'bound', workingDirectory },
          environment({ agencyConfig: undefined }),
        ),
      ).toBe('directoryRequired');
    }
  });

  it('accepts a picked device without a directory where it may be inherited', () => {
    const inherited = { directoryOptional: true };
    expect(
      getChannelAgentIssue({ agentId: 'pi', deviceId: 'bound' }, environment(), inherited),
    ).toBeUndefined();
    expect(
      getChannelAgentIssue(
        { agentId: 'pi', deviceId: 'bound' },
        environment({ devices: [device('bound', { online: false })] }),
        inherited,
      ),
    ).toBe('deviceOffline');
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
  ] as const)('blocks unsafe state of a picked device %o', (patch, issue) => {
    const env = environment({
      ...patch,
      ...('devices' in patch ? { devices: [...patch.devices] } : {}),
    });
    expect(
      getChannelAgentIssue({ agentId: 'pi', deviceId: 'bound', workingDirectory: '/project' }, env),
    ).toBe(issue);
  });

  it('allows a ready Agent and prevents pending/invalid/empty submissions', () => {
    const selection = { agentId: 'pi', deviceId: 'bound', workingDirectory: '/project' };
    expect(getChannelAgentIssue(selection, environment())).toBeUndefined();
    expect(canSubmitChannelAgents([])).toBe(false);
    expect(canSubmitChannelAgents([{ ...selection, initialized: false }])).toBe(false);
    expect(
      canSubmitChannelAgents([{ ...selection, initialized: true, issue: 'deviceOffline' }]),
    ).toBe(false);
    expect(canSubmitChannelAgents([{ ...selection, initialized: true }])).toBe(true);
    expect(toChannelAgentSelection({ ...selection, initialized: true, issue: undefined })).toEqual(
      selection,
    );
  });
});

describe('Channel runtime support', () => {
  const withRuntime = (type: string) =>
    environment({
      agencyConfig: { ...environment().agencyConfig, heterogeneousProvider: { type } as never },
    });
  const selection = { agentId: 'agent', deviceId: 'bound', workingDirectory: '/project' };

  it.each(['kimi-code', 'codebuddy', 'cursor', 'opencode', 'deepseek-harness'])(
    'accepts the local %s runtime',
    (type) => {
      expect(getChannelAgentIssue(selection, withRuntime(type))).toBeUndefined();
    },
  );

  it.each(['openclaw', 'hermes'])('rejects the remote-task %s runtime', (type) => {
    expect(getChannelAgentIssue(selection, withRuntime(type))).toBe('unsupportedRuntime');
  });
});

describe('Channel member submission guard', () => {
  const ready = { agentId: 'native', initialized: true };
  const pending = { agentId: 'pi', initialized: true, issue: 'deviceRequired' as const };

  it('creates a Channel with only its creator, people only, or ready Agents', () => {
    expect(canSubmitChannelMembers([], { creating: true, people: 0 })).toBe(true);
    expect(canSubmitChannelMembers([], { creating: true, people: 2 })).toBe(true);
    expect(canSubmitChannelMembers([ready], { creating: true, people: 0 })).toBe(true);
    expect(canSubmitChannelMembers([ready, pending], { creating: true, people: 1 })).toBe(false);
  });

  it('requires an invitation to add someone', () => {
    expect(canSubmitChannelMembers([], { creating: false, people: 0 })).toBe(false);
    expect(canSubmitChannelMembers([], { creating: false, people: 1 })).toBe(true);
    expect(canSubmitChannelMembers([pending], { creating: false, people: 1 })).toBe(false);
  });
});
