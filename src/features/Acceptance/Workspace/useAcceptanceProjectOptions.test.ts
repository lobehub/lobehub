/**
 * @vitest-environment happy-dom
 *
 * The acceptance project menus read the project store's list replica instead of
 * fetching `project.listAll` again under their own cache key.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectService } from '@/services/project';
import { useProjectStore } from '@/store/project';

import { useAcceptanceProjectOptions } from './useAcceptanceProjectMenuItem';

const project = (id: string) => ({ id, name: id }) as never;

const seed = (items: unknown[] | undefined, source?: 'server' | 'storage', error?: unknown) => {
  act(() =>
    useProjectStore.setState({
      projectListMap: items ? { all: items as never } : {},
      projectListReplica: {
        entries: source ? { all: { pending: [], source, updatedAt: 1 } } : {},
      } as never,
      useFetchProjectList: () =>
        ({ error, isHydrated: true, isValidating: false, revalidate: vi.fn() }) as never,
    }),
  );
};

describe('useAcceptanceProjectOptions', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'listAll').mockResolvedValue({ data: [] } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses the project list replica without a request of its own', () => {
    seed([project('p1')], 'server');

    const { result } = renderHook(() => useAcceptanceProjectOptions(true));

    expect(result.current.projects?.map((item) => item.id)).toEqual(['p1']);
    expect(projectService.listAll).not.toHaveBeenCalled();
  });

  it('treats a restored empty project list as loading until the server confirms it', () => {
    seed([], 'storage');
    const { result, rerender } = renderHook(() => useAcceptanceProjectOptions(true));
    // "No projects yet" would invite creating a duplicate of one the user owns.
    expect(result.current.projects).toBeUndefined();

    seed([], 'server');
    rerender();
    expect(result.current.projects).toEqual([]);
  });

  it('keeps the last projects when a background refresh fails', () => {
    seed([project('p1')], 'storage', new Error('offline'));

    const { result } = renderHook(() => useAcceptanceProjectOptions(true));

    expect(result.current.projects?.map((item) => item.id)).toEqual(['p1']);
    expect(result.current.error).toBeUndefined();
  });
});
