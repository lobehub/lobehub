import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProfileExecutionTarget } from './useProfileExecutionTarget';

const testState = vi.hoisted(() => ({
  agencyConfig: undefined as LobeAgentAgencyConfig | undefined,
  isDesktop: true,
  isPreferenceLoading: false,
  workspaceScoped: false,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: testState.agencyConfig,
    canDisplayExecutionTarget: !testState.isPreferenceLoading,
    canSelectExecutionTarget: !testState.isPreferenceLoading,
    executionTargetOverridden: false,
    isPreferenceLoading: testState.isPreferenceLoading,
    topicDeviceUnknown: false,
    workspaceScoped: testState.workspaceScoped,
  }),
}));

describe('useProfileExecutionTarget', () => {
  beforeEach(() => {
    testState.agencyConfig = undefined;
    testState.isDesktop = true;
    testState.isPreferenceLoading = false;
    testState.workspaceScoped = false;
  });

  it('describes the bound device on a desktop for an agent connected from a device', () => {
    // What the connect wizard writes when the agent is created on a remote
    // device. The profile used to probe the desktop it was open on instead.
    testState.agencyConfig = {
      boundDeviceId: 'device-us-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.target).toBe('device');
    expect(result.current.panel).toEqual({ deviceId: 'device-us-1', kind: 'device' });
  });

  it('probes this desktop only when the agent runs locally', () => {
    testState.agencyConfig = {
      boundDeviceId: 'this-desktop',
      executionTarget: 'local',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.panel).toEqual({ kind: 'local' });
    expect(result.current.deviceId).toBeUndefined();
  });

  it('opens on the cloud config when a desktop agent runs in the sandbox', () => {
    testState.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.panel).toEqual({ kind: 'cloud' });
  });

  it('describes the pinned desktop when a local agent is opened on the web', () => {
    testState.isDesktop = false;
    testState.agencyConfig = {
      boundDeviceId: 'my-desktop',
      executionTarget: 'local',
      heterogeneousProvider: { type: 'codex' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.panel).toEqual({ deviceId: 'my-desktop', kind: 'device' });
  });

  it('never runs a shared workspace default on whichever member opened it', () => {
    testState.workspaceScoped = true;
    testState.agencyConfig = {
      executionTarget: 'local',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.target).toBe('sandbox');
    expect(result.current.panel).toEqual({ kind: 'cloud' });
  });

  it('waits for a device pick when a device-only CLI has no environment', () => {
    testState.isDesktop = false;
    testState.agencyConfig = { heterogeneousProvider: { type: 'opencode' } };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.panel).toEqual({ kind: 'pending' });
  });

  it('flags API auth on the cloud sandbox, where dispatch rejects it', () => {
    // The sandbox panel has no auth controls, so the profile must surface the
    // block and the way back to subscription auth.
    testState.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { authMode: 'api', type: 'claude-code' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.panel).toEqual({ kind: 'cloud' });
    expect(result.current.isApiAuthBlocked).toBe(true);
  });

  it('flags API auth on a bound device too', () => {
    testState.agencyConfig = {
      boundDeviceId: 'device-us-1',
      executionTarget: 'device',
      heterogeneousProvider: { authMode: 'api', type: 'codex' },
    };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.isApiAuthBlocked).toBe(true);
  });

  it('keeps API auth usable on this desktop and ignores subscription auth', () => {
    testState.agencyConfig = {
      executionTarget: 'local',
      heterogeneousProvider: { authMode: 'api', type: 'claude-code' },
    };
    expect(
      renderHook(() => useProfileExecutionTarget('agent-1')).result.current.isApiAuthBlocked,
    ).toBe(false);

    testState.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { authMode: 'subscription', type: 'claude-code' },
    };
    expect(
      renderHook(() => useProfileExecutionTarget('agent-1')).result.current.isApiAuthBlocked,
    ).toBe(false);
  });

  it('reports a pending target while the workspace preference loads', () => {
    testState.isPreferenceLoading = true;
    testState.agencyConfig = { heterogeneousProvider: { type: 'claude-code' } };

    const { result } = renderHook(() => useProfileExecutionTarget('agent-1'));

    expect(result.current.isPending).toBe(true);
    expect(result.current.isSelectable).toBe(false);
  });
});
