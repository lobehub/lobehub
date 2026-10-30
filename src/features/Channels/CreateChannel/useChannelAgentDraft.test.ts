import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceListResult } from '@/store/device/useDeviceList';

import {
  canSubmitChannelAgents,
  type ChannelAgentDraft,
  toChannelAgentSelection,
} from './agentEnvironment';
import { useChannelAgentDraft } from './useChannelAgentDraft';

const { source, sync } = vi.hoisted(() => ({
  source: { agencyConfig: {} as LobeAgentAgencyConfig },
  sync: { error: undefined, isValidating: false, mutate: vi.fn() },
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: source.agencyConfig,
    isPreferenceLoading: false,
    workspaceScoped: false,
  }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({
      agentMap: { agent: { model: 'deepseek-chat' } },
      agentConfigReplica: { entries: { agent: { source: 'server' } } },
      agentNotFoundMap: {},
      useHydrateAgentConfig: () => sync,
    }),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({
      gatewayDeviceInfo: { deviceId: 'bound' },
    }),
}));
const devices: DeviceListResult = {
  data: [
    {
      channels: [],
      defaultCwd: '/device-default',
      deviceId: 'bound',
      enroller: null,
      friendlyName: null,
      hostname: 'Computer',
      identitySource: null,
      lastSeen: '',
      online: true,
      platform: 'darwin',
      registered: true,
      scope: 'personal',
    },
  ],
  error: undefined,
  isConfirmed: true,
  isValidating: false,
  mutate: vi.fn(),
};

const setup = () =>
  renderHook(() => {
    const [drafts, setDrafts] = useState<ChannelAgentDraft[]>([
      { agentId: 'agent', initialized: false },
    ]);
    const controls = useChannelAgentDraft(drafts[0], devices, setDrafts);
    return { ...controls, drafts };
  });

describe('Channel Agent device selection events', () => {
  beforeEach(() => {
    source.agencyConfig = {
      boundDeviceId: 'bound',
      executionTarget: 'device',
      workingDirByDevice: { bound: '/agent-project' },
    };
  });
  afterEach(cleanup);

  it.each([undefined, null, ''])(
    'clears the inherited Native device and directory for an empty selection (%s)',
    (value) => {
      const defaults = structuredClone(source.agencyConfig);
      const { result, rerender } = setup();
      expect(result.current.requiresDevice).toBe(false);
      expect(result.current.draft.deviceId).toBe('bound');
      expect(result.current.draft.workingDirectory).toBe('/agent-project');
      // Select normalizes its empty-string option to undefined in onChange.
      act(() => result.current.changeDevice(value));
      expect(result.current.draft.deviceId).toBeUndefined();
      expect(result.current.draft.workingDirectory).toBeUndefined();
      expect(result.current.draft.issue).toBeUndefined();
      expect(canSubmitChannelAgents(result.current.drafts)).toBe(true);
      rerender();
      expect(toChannelAgentSelection(result.current.drafts[0])).toEqual({
        agentId: 'agent',
        deviceId: undefined,
        workingDirectory: undefined,
      });
      expect(source.agencyConfig).toEqual(defaults);
    },
  );

  it('can select the same device again after clearing it', () => {
    const { result } = setup();
    act(() => result.current.changeDevice(undefined));
    act(() => result.current.changeDevice('bound'));
    expect(result.current.draft).toMatchObject({
      deviceId: 'bound',
      workingDirectory: '/agent-project',
    });
    expect(canSubmitChannelAgents(result.current.drafts)).toBe(true);
  });

  it.each(['pi', 'codex'] as const)(
    'clears %s visibly but still requires a device before submission',
    (runtime) => {
      source.agencyConfig.heterogeneousProvider = { type: runtime };
      const { result, rerender } = setup();
      expect(result.current.requiresDevice).toBe(true);
      act(() => result.current.changeDevice(undefined));
      rerender();
      expect(result.current.draft.deviceId).toBeUndefined();
      expect(result.current.draft.workingDirectory).toBeUndefined();
      expect(result.current.draft.issue).toBe('deviceRequired');
      expect(canSubmitChannelAgents(result.current.drafts)).toBe(false);
    },
  );
});
