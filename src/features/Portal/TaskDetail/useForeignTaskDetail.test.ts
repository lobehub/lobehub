/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FOREIGN_TASK_NOT_FOUND, useForeignTaskDetail } from './useForeignTaskDetail';

const mocks = vi.hoisted(() => ({
  createWorkspaceLambdaClient: vi.fn(),
  detailQuery: vi.fn(),
  lambdaDetailQuery: vi.fn(),
  portalStack: [] as unknown[],
}));

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: (workspaceId: string | null) => {
    mocks.createWorkspaceLambdaClient(workspaceId);
    return { task: { detail: { query: mocks.detailQuery } } };
  },
  lambdaClient: { task: { detail: { query: mocks.lambdaDetailQuery } } },
  withLlmRelay: vi.fn(),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws-active',
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({ portalStack: mocks.portalStack }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

describe('useForeignTaskDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.portalStack = [
      { taskId: 'T-198', type: 'taskDetail', workspace: { id: 'ws-1', slug: 'lobe-team' } },
    ];
  });

  it('reads the task through its own workspace, not the active scope', async () => {
    mocks.detailQuery.mockResolvedValue({
      data: { id: 'task_1', identifier: 'T-198', status: 'completed' },
    });
    const { result } = renderHook(() => useForeignTaskDetail(), { wrapper });

    await waitFor(() => expect(result.current.data?.identifier).toBe('T-198'));
    expect(mocks.createWorkspaceLambdaClient).toHaveBeenCalledWith('ws-1');
    expect(mocks.detailQuery).toHaveBeenCalledWith({ id: 'T-198' });
    expect(mocks.lambdaDetailQuery).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a tRPC NOT_FOUND',
      () => mocks.detailQuery.mockRejectedValue({ data: { code: 'NOT_FOUND' } }),
    ],
    ['an empty result', () => mocks.detailQuery.mockResolvedValue({ data: null })],
  ])('maps %s to a resolved not-found', async (_, arrange) => {
    arrange();
    const { result } = renderHook(() => useForeignTaskDetail(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect((result.current.error as { code?: string }).code).toBe(FOREIGN_TASK_NOT_FOUND);
  });

  it('keeps other failures retryable', async () => {
    const failure = Object.assign(new Error('boom'), { data: { code: 'INTERNAL_SERVER_ERROR' } });
    mocks.detailQuery.mockRejectedValue(failure);
    const { result } = renderHook(() => useForeignTaskDetail(), { wrapper });

    await waitFor(() => expect(result.current.error).toBe(failure));
  });

  it('reads nothing for an active-scope task', () => {
    mocks.portalStack = [{ taskId: 'T-7', type: 'taskDetail' }];
    renderHook(() => useForeignTaskDetail(), { wrapper });

    expect(mocks.createWorkspaceLambdaClient).not.toHaveBeenCalled();
  });
});
