import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode, useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInitLibraryTree } from './useInitLibraryTree';

const { mockInit, resourceManagerState } = vi.hoisted(() => {
  const state = {
    libraryId: undefined as string | undefined,
    setLibraryId: (id?: string) => {
      state.libraryId = id;
    },
  };
  return { mockInit: vi.fn(), resourceManagerState: state };
});

vi.mock('@/store/tree', () => ({
  useTreeStore: (selector: (s: { init: typeof mockInit }) => unknown) =>
    selector({ init: mockInit }),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (s: typeof resourceManagerState) => unknown) =>
    selector(resourceManagerState),
}));

const routeWrapper =
  (path: string, pattern = '/resource/library/:id/*') =>
  ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Routes, null, createElement(Route, { element: children, path: pattern })),
    );

describe('useInitLibraryTree', () => {
  beforeEach(() => {
    mockInit.mockReset();
    resourceManagerState.libraryId = undefined;
  });

  it('initialises the tree from the route before the page syncs the library into the store', () => {
    const { result } = renderHook(() => useInitLibraryTree(), {
      wrapper: routeWrapper('/resource/library/kb-1/some-folder'),
    });

    expect(result.current).toBe('kb-1');
    expect(mockInit).toHaveBeenCalledWith('kb-1');
  });

  it('initialises before passive effects, so the seeded tree is in the first painted frame', () => {
    const order: string[] = [];
    mockInit.mockImplementation(() => order.push('init'));

    renderHook(
      () => {
        useInitLibraryTree();
        useEffect(() => {
          order.push('passive effect');
        }, []);
      },
      { wrapper: routeWrapper('/resource/library/kb-1') },
    );

    expect(order).toEqual(['init', 'passive effect']);
  });

  it('points the store at the route library before paint, so row actions never target the previous one', () => {
    // Coming from library A: the page segment that syncs the store has not mounted yet.
    resourceManagerState.libraryId = 'kb-a';
    let storeAtInit: string | undefined;
    mockInit.mockImplementation(() => {
      storeAtInit = resourceManagerState.libraryId;
    });

    renderHook(() => useInitLibraryTree(), { wrapper: routeWrapper('/resource/library/kb-b') });

    expect(storeAtInit).toBe('kb-b');
    expect(resourceManagerState.libraryId).toBe('kb-b');
  });

  it('falls back to the store outside a library route', () => {
    resourceManagerState.libraryId = 'kb-2';

    const { result } = renderHook(() => useInitLibraryTree(), {
      wrapper: routeWrapper('/resource', '/resource'),
    });

    expect(result.current).toBe('kb-2');
    expect(mockInit).toHaveBeenCalledWith('kb-2');
  });
});
