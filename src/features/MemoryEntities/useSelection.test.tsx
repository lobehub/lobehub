// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEntityTrailStore } from './store';
import { useSelection } from './useSelection';

const setup = (url: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ location: useLocation(), selection: useSelection() }), { wrapper });
};

describe('useSelection', () => {
  beforeEach(() => useEntityTrailStore.setState({ history: [] }));

  it('opens the context a memory deep link points at', () => {
    // The memory detail portal links here via getMemoryDetailPath(LayersEnum.Context, id).
    const { result } = setup('/memory/contexts?contextId=ctx-from-chat');
    expect(result.current.selection.selectedId).toBe('ctx-from-chat');
  });

  it('follows a link, keeps the way back in the URL trail, and returns', () => {
    const { result } = setup('/memory/contexts?contextId=ctx-a');

    act(() => result.current.selection.open('ctx-b'));
    expect(result.current.selection.selectedId).toBe('ctx-b');
    expect(result.current.location.search).toBe('?contextId=ctx-b');
    expect(result.current.selection.history).toEqual(['ctx-a']);

    act(() => result.current.selection.back());
    expect(result.current.selection.selectedId).toBe('ctx-a');
    expect(result.current.selection.history).toEqual([]);
  });

  it('pins the default page only when nothing is selected', () => {
    const { result } = setup('/memory/contexts');
    act(() => result.current.selection.ensureSelected('ctx-default'));
    expect(result.current.selection.selectedId).toBe('ctx-default');

    act(() => result.current.selection.ensureSelected('ctx-other'));
    expect(result.current.selection.selectedId).toBe('ctx-default');
  });

  it('starts a fresh trail when picking from the list', () => {
    const { result } = setup('/memory/contexts?contextId=ctx-a');
    act(() => result.current.selection.open('ctx-b'));
    act(() => result.current.selection.select('ctx-c'));

    expect(result.current.selection.selectedId).toBe('ctx-c');
    expect(result.current.selection.history).toEqual([]);
  });
});
