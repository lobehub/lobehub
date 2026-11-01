import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resourcePermissionActions, useResourcePermissionStore } from '@/store/resourcePermission';

import { useResourceCollaborators } from './useResourceCollaborators';

const serviceMocks = vi.hoisted(() => ({
  addCollaborators: vi.fn(),
  listCollaborators: vi.fn(),
  removeCollaborator: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: serviceMocks,
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(async () => undefined),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

/** The replica sync queries registered for the collaborator list. */
const syncKeys = async () => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.map(([key]) => key)
    .filter((key) => Array.isArray(key) && key[1] === 'resourceCollaborators');
};

const KEY = 'knowledgeBase:kb-1';
const list = () => useResourcePermissionStore.getState().collaboratorsMap[KEY];
const seed = (rows: { userId: string }[]) =>
  useResourcePermissionStore.setState({ collaboratorsMap: { [KEY]: rows as any } });

describe('useResourceCollaborators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourcePermissionActions.reset();
  });

  it('does not fetch without a resource id or when disabled', async () => {
    renderHook(() => useResourceCollaborators('knowledgeBase', undefined));
    renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1', { enabled: false }));

    expect(await syncKeys()).toHaveLength(0);
  });

  it('paints a list fetched earlier this session without a loading state', () => {
    seed([{ userId: 'member-1' }]);

    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    expect(result.current.collaborators).toEqual([{ userId: 'member-1' }]);
    expect(result.current.isLoading).toBe(false);
  });

  it('adds collaborators then re-fetches the list', async () => {
    serviceMocks.addCollaborators.mockResolvedValue(undefined);
    serviceMocks.listCollaborators.mockResolvedValue([{ userId: 'member-1' }]);
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
    expect(serviceMocks.listCollaborators).toHaveBeenCalledWith('knowledgeBase', 'kb-1');
    expect(list()).toEqual([{ userId: 'member-1' }]);
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
    seed([{ userId: 'member-1' }, { userId: 'member-2' }]);
    let settle!: () => void;
    serviceMocks.removeCollaborator.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    serviceMocks.listCollaborators.mockResolvedValue([{ userId: 'member-2' }]);
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.removeCollaborator('member-1');
    });

    expect(list()).toEqual([{ userId: 'member-2' }]);

    await act(async () => {
      settle();
      await pending;
    });

    expect(serviceMocks.removeCollaborator).toHaveBeenCalledWith(
      'knowledgeBase',
      'kb-1',
      'member-1',
    );
    expect(list()).toEqual([{ userId: 'member-2' }]);
  });

  it('rolls a failed removal back and surfaces it as a toast instead of throwing', async () => {
    const { toast } = await import('@lobehub/ui');
    seed([{ userId: 'member-1' }]);
    serviceMocks.removeCollaborator.mockRejectedValue(new Error('FORBIDDEN'));
    const { result } = renderHook(() => useResourceCollaborators('knowledgeBase', 'kb-1'));

    await act(async () => {
      await result.current.removeCollaborator('member-1');
    });

    expect(list()).toEqual([{ userId: 'member-1' }]);
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(result.current.mutating).toBe(false);
  });
});
