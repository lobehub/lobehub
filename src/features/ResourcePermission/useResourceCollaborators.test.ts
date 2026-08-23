import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResourceCollaborators } from './useResourceCollaborators';

const serviceMocks = vi.hoisted(() => ({
  addCollaborators: vi.fn(),
  listCollaborators: vi.fn(),
  removeCollaborator: vi.fn(),
}));

const swrState = vi.hoisted(() => ({
  data: undefined as unknown,
  keys: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: serviceMocks,
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown) => {
    swrState.keys.push(key);
    return { data: swrState.data, error: undefined, isLoading: false, mutate: swrState.mutate };
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: vi.fn() } }));

describe('useResourceCollaborators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrState.data = undefined;
    swrState.keys = [];
  });

  it('does not fetch without a resource id or when disabled', () => {
    renderHook(() => useResourceCollaborators('knowledgeBase', undefined));
    renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1', { enabled: false }));

    expect(swrState.keys).toEqual([null, null]);
  });

  it('adds collaborators then revalidates', async () => {
    serviceMocks.addCollaborators.mockResolvedValue(undefined);
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    await act(async () => {
      await result.current.addCollaborators(['member-1'], 'edit');
    });

    expect(serviceMocks.addCollaborators).toHaveBeenCalledWith(
      'knowledgeBase',
      'kb-1',
      ['member-1'],
      'edit',
    );
    expect(swrState.mutate).toHaveBeenCalled();
  });

  it('reports a failed add so the caller can keep the picker open', async () => {
    serviceMocks.addCollaborators.mockRejectedValue(new Error('membership changed'));
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addCollaborators(['member-1'], 'edit');
    });

    // The rejection is surfaced as a toast rather than rethrown, so the return
    // value is the only thing telling the caller nobody was added.
    expect(added).toBe(false);
  });

  it('adding an empty selection is a no-op', async () => {
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    await act(async () => {
      await result.current.addCollaborators([], 'edit');
    });

    expect(serviceMocks.addCollaborators).not.toHaveBeenCalled();
  });

  it('removes optimistically: the row is dropped before the request settles', async () => {
    swrState.data = [{ userId: 'member-1' }, { userId: 'member-2' }];
    serviceMocks.removeCollaborator.mockResolvedValue(undefined);
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    await act(async () => {
      await result.current.removeCollaborator('member-1');
    });

    expect(swrState.mutate).toHaveBeenNthCalledWith(1, [{ userId: 'member-2' }], false);
    expect(serviceMocks.removeCollaborator).toHaveBeenCalledWith(
      'knowledgeBase',
      'kb-1',
      'member-1',
    );
  });

  it('rolls a failed removal back and surfaces it as a toast instead of throwing', async () => {
    const { toast } = await import('@lobehub/ui/base-ui');
    swrState.data = [{ userId: 'member-1' }];
    serviceMocks.removeCollaborator.mockRejectedValue(new Error('FORBIDDEN'));
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    await act(async () => {
      await result.current.removeCollaborator('member-1');
    });

    // optimistic drop, then rollback to the pre-removal list
    expect(swrState.mutate).toHaveBeenNthCalledWith(1, [], false);
    expect(swrState.mutate).toHaveBeenLastCalledWith([{ userId: 'member-1' }], false);
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(result.current.mutating).toBe(false);
  });
});
