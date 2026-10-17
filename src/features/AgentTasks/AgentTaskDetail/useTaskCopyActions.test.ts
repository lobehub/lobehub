/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskCopyActions } from './useTaskCopyActions';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  taskState: {
    activeTaskId: 'T-1' as string | undefined,
    taskDetailMap: {
      'T-1': { agentId: 'agt_1', name: 'Ship the thing' },
    } as Record<string, { agentId?: string | null; name?: string | null }>,
  },
  toastSuccess: vi.fn(),
  workspaceSlug: 'ws-slug' as string | undefined,
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      copyToClipboard: mocks.copyToClipboard,
    }),
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      toast: { success: mocks.toastSuccess },
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.workspaceSlug,
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.taskState),
}));

describe('useTaskCopyActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskState.activeTaskId = 'T-1';
    mocks.taskState.taskDetailMap = { 'T-1': { agentId: 'agt_1', name: 'Ship the thing' } };
    mocks.workspaceSlug = 'ws-slug';
  });

  it('copies an absolute, workspace-aware link carrying the readable slug', async () => {
    const { result } = renderHook(() => useTaskCopyActions());

    await result.current.copyLink();

    expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      'https://example.com/ws-slug/agent/agt_1/task/T-1/ship-the-thing',
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('taskList.contextMenu.copyLinkSuccess');
  });

  it('drops the workspace prefix in personal mode', async () => {
    mocks.workspaceSlug = undefined;
    const { result } = renderHook(() => useTaskCopyActions());

    await result.current.copyLink();

    expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      'https://example.com/agent/agt_1/task/T-1/ship-the-thing',
    );
  });

  it('copies the bare task id', async () => {
    const { result } = renderHook(() => useTaskCopyActions());

    await result.current.copyId();

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('T-1');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('taskList.contextMenu.copyIdSuccess');
  });

  it('no-ops while no task is active, so the header buttons cannot copy a stale id', async () => {
    mocks.taskState.activeTaskId = undefined;
    const { result } = renderHook(() => useTaskCopyActions());

    await result.current.copyId();
    await result.current.copyLink();

    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
