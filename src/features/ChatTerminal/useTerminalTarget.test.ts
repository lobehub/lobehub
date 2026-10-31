import type { DeviceListItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { useChatTerminalStore } from './store';
import { LOCAL_TARGET } from './targetOptions';
import { useTerminalTarget } from './useTerminalTarget';

const device = (deviceId: string, defaultCwd: string) =>
  ({ defaultCwd, deviceId, online: true }) as DeviceListItem;

const { deviceStore, env } = vi.hoisted(() => ({
  deviceStore: { current: undefined as any },
  env: { currentDeviceId: undefined as string | undefined, isDesktop: false },
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return env.isDesktop;
  },
}));

// The topic runs on dev_b, in a directory that only exists there.
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: { boundDeviceId: 'dev_b', executionTarget: 'device' },
    isPreferenceLoading: false,
    workspaceScoped: false,
  }),
}));
vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => '/repo-on-b',
}));
vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => true }));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: unknown) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: env.currentDeviceId } }),
}));
vi.mock('@/store/device', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDeviceStore: Object.assign(
    (selector: (s: unknown) => unknown) => deviceStore.current(selector),
    { getState: () => deviceStore.current.getState() },
  ),
}));

const createTab = vi.fn(async () => {});

beforeEach(() => {
  env.currentDeviceId = undefined;
  env.isDesktop = false;
  deviceStore.current = create(() => ({
    deviceListMap: { all: [device('dev_a', '/home/a'), device('dev_b', '/home/b')] },
    deviceListReplica: { entries: { all: { source: 'server' } } },
    useFetchDevices: () => ({ error: undefined }),
  }));
  useChatTerminalStore.setState({ createTab, devicePickByTopic: {} });
  createTab.mockClear();
});

describe('useTerminalTarget', () => {
  it("defaults to the topic's device, in the conversation's directory", () => {
    const { result } = renderHook(() => useTerminalTarget('tpc_1', 'agt_1'));

    expect(result.current).toMatchObject({
      canSpawn: true,
      cwd: '/repo-on-b',
      targetDeviceId: 'dev_b',
    });
  });

  it("opens the switched-to device's shell in that device's directory, not the old target's", () => {
    const { result } = renderHook(() => useTerminalTarget('tpc_1', 'agt_1'));

    act(() => result.current.selectTarget('dev_a'));

    expect(createTab).toHaveBeenCalledWith('tpc_1', '/home/a', 'dev_a');
    expect(result.current).toMatchObject({ cwd: '/home/a', targetDeviceId: 'dev_a' });
  });

  it("goes back to the conversation's directory when switching back to its device", () => {
    useChatTerminalStore.setState({ devicePickByTopic: { tpc_1: { deviceId: 'dev_a' } } });
    const { result } = renderHook(() => useTerminalTarget('tpc_1', 'agt_1'));

    act(() => result.current.selectTarget('dev_b'));

    expect(createTab).toHaveBeenCalledWith('tpc_1', '/repo-on-b', 'dev_b');
  });

  it('does not carry the remote directory over when switching to this computer', () => {
    env.isDesktop = true;
    env.currentDeviceId = 'dev_local';
    const { result } = renderHook(() => useTerminalTarget('tpc_1', 'agt_1'));

    act(() => result.current.selectTarget(LOCAL_TARGET));

    expect(createTab).toHaveBeenCalledWith('tpc_1', undefined, undefined);
  });
});
