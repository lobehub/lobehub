/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskProjectChoice } from './useTaskProjectChoice';

const state = vi.hoisted(() => ({
  enabled: true,
  fetch: vi.fn(),
  projects: undefined as { id: string; name: string }[] | undefined,
  sync: { error: undefined as unknown, isValidating: false },
}));

vi.mock('@/store/project', () => ({
  useLoadedProjectList: () => state.projects,
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({
      useFetchProjectList: (enabled: boolean) => {
        state.fetch(enabled);
        return state.sync;
      },
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => state.enabled },
}));

beforeEach(() => {
  state.enabled = true;
  state.fetch.mockClear();
  state.projects = [{ id: 'p1', name: 'Apollo' }];
  state.sync = { error: undefined, isValidating: false };
});

describe('useTaskProjectChoice', () => {
  it('starts empty outside a project and sends nothing', () => {
    const { result } = renderHook(() => useTaskProjectChoice());
    expect(result.current.projectChoice).toBeNull();
    expect(result.current.createProjectId).toBeUndefined();
  });

  it('prefills the page project, which the user can clear', () => {
    const { result } = renderHook(() => useTaskProjectChoice('p1'));
    expect(result.current.createProjectId).toBe('p1');

    act(() => result.current.setProjectChoice(null));
    expect(result.current.projectChoice).toBeNull();
    expect(result.current.createProjectId).toBeUndefined();
  });

  it('keeps the page project while Projects is off, but never a hidden choice', () => {
    state.enabled = false;
    const scoped = renderHook(() => useTaskProjectChoice('p1'));
    expect(scoped.result.current.createProjectId).toBe('p1');

    const unscoped = renderHook(() => useTaskProjectChoice());
    act(() => unscoped.result.current.setProjectChoice('p1'));
    expect(unscoped.result.current.createProjectId).toBeUndefined();
    expect(state.fetch).toHaveBeenCalledWith(false);
  });

  it('does not fetch or send for a composer without a picker', () => {
    const { result } = renderHook(() => useTaskProjectChoice(undefined, false));
    expect(state.fetch).toHaveBeenCalledWith(false);
    expect(result.current.createProjectId).toBeUndefined();
  });

  it('drops a restored choice once a fresh list proves it is gone', () => {
    const { result } = renderHook(() => useTaskProjectChoice());
    act(() => result.current.setProjectChoice('gone'));
    expect(result.current.projectChoice).toBeNull();
  });

  it.each([
    ['the list is still revalidating', { isValidating: true }],
    ['the list failed to load', { error: new Error('offline') }],
  ])('keeps a choice it cannot judge while %s', (_label, sync) => {
    state.sync = { error: undefined, isValidating: false, ...sync };
    const { result } = renderHook(() => useTaskProjectChoice());
    act(() => result.current.setProjectChoice('gone'));
    expect(result.current.projectChoice).toBe('gone');
  });

  it('leaves the page project to the server even when it is not listed', () => {
    const { result } = renderHook(() => useTaskProjectChoice('private-project'));
    expect(result.current.createProjectId).toBe('private-project');
  });
});
