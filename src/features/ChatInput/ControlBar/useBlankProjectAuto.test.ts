import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { useBlankProjectAuto } from './useBlankProjectAuto';

const env = vi.hoisted(() => ({
  online: new Set<string>(['dev-a', 'dev-b']),
  loading: false,
  ownDevice: undefined as { deviceId: string; sandboxFallback: boolean } | undefined,
}));

const directory = (id: string, deviceId: string) => ({
  deviceId,
  environmentId: 'env-1',
  id,
  instanceId: `inst-${id}`,
  permission: 'readWrite',
  runnable: true,
});

vi.mock('@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments', () => ({
  isDeviceOnline: (_devices: unknown, deviceId: string) => env.online.has(deviceId),
  isExecutionDirectoryAvailable: (d: { deviceId: string }) => env.online.has(d.deviceId),
  useProjectExecutionEnvironments: () => ({
    ordered: [
      { directory: directory('dir-a', 'dev-a'), id: 'dir-a', kind: 'directory' },
      { directory: directory('dir-b', 'dev-b'), id: 'dir-b', kind: 'directory' },
      { id: 'sandbox', kind: 'sandbox' },
    ],
  }),
}));
vi.mock('@/features/Projects/WorkingDirectories/useAgentFixedDeviceId', () => ({
  useAgentFixedDeviceId: () => undefined,
}));
vi.mock('@/features/Projects/WorkingDirectories/useAgentOwnDevice', () => ({
  useAgentOwnDevice: () => ({ loading: env.loading, ownDevice: env.ownDevice }),
}));
vi.mock('@/store/device', () => ({ useDeviceList: () => ({ data: [] }) }));

const pending = () => useChatStore.getState().pendingNewTopicDirectory;

beforeEach(() => {
  env.online = new Set(['dev-a', 'dev-b']);
  env.loading = false;
  env.ownDevice = undefined;
  act(() =>
    useChatStore
      .getState()
      .setPendingNewTopicDirectory({ agentId: 'agt', projectWorkingDirectoryId: 'dir-b' }),
  );
});

describe('useBlankProjectAuto', () => {
  it("stages the project's first available runner when picked", () => {
    const { result } = renderHook(() => useBlankProjectAuto('agt', 'prj'));
    expect(result.current?.active).toBe(false);

    act(() => result.current?.onSelect());

    expect(pending()).toEqual({ agentId: 'agt', auto: true, projectWorkingDirectoryId: 'dir-a' });
    expect(result.current?.active).toBe(true);
  });

  it('follows the order while automatic, down to the sandbox', () => {
    const { rerender, result } = renderHook(() => useBlankProjectAuto('agt', 'prj'));
    act(() => result.current?.onSelect());

    env.online = new Set(['dev-b']);
    rerender();
    expect(pending()).toMatchObject({ auto: true, projectWorkingDirectoryId: 'dir-b' });

    env.online = new Set();
    rerender();
    expect(pending()).toEqual({ agentId: 'agt', auto: true, projectId: 'prj' });
  });

  it('leaves a hand-picked runner alone', () => {
    const { rerender } = renderHook(() => useBlankProjectAuto('agt', 'prj'));
    env.online = new Set(['dev-a']);
    rerender();

    expect(pending()).toEqual({ agentId: 'agt', projectWorkingDirectoryId: 'dir-b' });
  });

  // Review: split panes on two projects of the same agent restaged each other.
  it("does not drive another project's staged draft", () => {
    act(() =>
      useChatStore
        .getState()
        .setPendingNewTopicDirectory({ agentId: 'agt', auto: true, projectId: 'other' }),
    );
    const { result } = renderHook(() => useBlankProjectAuto('agt', 'prj'));

    expect(result.current?.active).toBe(false);
    expect(pending()).toEqual({ agentId: 'agt', auto: true, projectId: 'other' });
  });

  it("stages a heterogeneous agent on its own device's directory, outside the order", () => {
    env.ownDevice = { deviceId: 'dev-b', sandboxFallback: false };
    const { rerender, result } = renderHook(() => useBlankProjectAuto('agt', 'prj'));
    act(() => result.current?.onSelect());
    expect(pending()).toMatchObject({ auto: true, projectWorkingDirectoryId: 'dir-b' });

    // Offline: a device-only agent does not move to dev-a; the draft waits on
    // the project and says why.
    env.online = new Set(['dev-a']);
    rerender();
    expect(pending()).toEqual({ agentId: 'agt', auto: true, projectId: 'prj' });
    expect(result.current?.notice).toEqual({ blocked: true, reason: 'offline' });
  });

  // Review: a workspace member's device pick still loading read as "no own
  // device", so Auto staged the draft on another runner before it arrived.
  it("stages nothing while the agent's own device is still loading", () => {
    env.loading = true;
    const { result } = renderHook(() => useBlankProjectAuto('agt', 'prj'));

    expect(result.current).toBeUndefined();
    expect(pending()).toEqual({ agentId: 'agt', projectWorkingDirectoryId: 'dir-b' });
  });

  it('offers nothing without a project (a started conversation)', () => {
    const { result } = renderHook(() => useBlankProjectAuto('agt', undefined));
    expect(result.current).toBeUndefined();
  });
});
