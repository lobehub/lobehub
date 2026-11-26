import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { useBlankProjectAuto } from './useBlankProjectAuto';

const env = vi.hoisted(() => ({
  online: new Set<string>(['dev-a', 'dev-b']),
  selectExecutionTarget: vi.fn(),
}));

const directory = (id: string, deviceId: string) => ({
  deviceId,
  environmentId: 'env-1',
  id,
  instanceId: `inst-${id}`,
  permission: 'readWrite',
});

vi.mock('@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments', () => ({
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
vi.mock('@/features/ChatInput/hooks/useSelectExecutionTarget', () => ({
  useSelectExecutionTarget: () => env.selectExecutionTarget,
}));
vi.mock('@/store/device', () => ({ useDeviceList: () => ({ data: [] }) }));

const pending = () => useChatStore.getState().pendingNewTopicDirectory;

beforeEach(() => {
  env.online = new Set(['dev-a', 'dev-b']);
  env.selectExecutionTarget.mockReset();
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
    expect(env.selectExecutionTarget).toHaveBeenCalledWith('sandbox');
  });

  it('leaves a hand-picked runner alone', () => {
    const { rerender } = renderHook(() => useBlankProjectAuto('agt', 'prj'));
    env.online = new Set(['dev-a']);
    rerender();

    expect(pending()).toEqual({ agentId: 'agt', projectWorkingDirectoryId: 'dir-b' });
  });

  // Review: split panes on two projects of the same agent restaged each other.
  // Review: a "+" that resolved straight to the sandbox never moved the agent
  // there, so the first message could run on its previous device.
  it('sends the agent to the sandbox when Auto starts there', () => {
    env.online = new Set();
    act(() =>
      useChatStore
        .getState()
        .setPendingNewTopicDirectory({ agentId: 'agt', auto: true, projectId: 'prj' }),
    );

    const { rerender } = renderHook(() => useBlankProjectAuto('agt', 'prj'));
    rerender();

    expect(env.selectExecutionTarget).toHaveBeenCalledTimes(1);
    expect(env.selectExecutionTarget).toHaveBeenCalledWith('sandbox');
  });

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

  it('offers nothing without a project (a started conversation)', () => {
    const { result } = renderHook(() => useBlankProjectAuto('agt', undefined));
    expect(result.current).toBeUndefined();
  });
});
