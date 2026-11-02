import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type QuickNoteItem, quickNoteService } from '@/services/quickNote';

import { initialState } from './initialState';
import { useQuickNoteStore } from './store';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const page = (items: QuickNoteItem[]) => ({ items, nextCursor: null });

const createNoteItem = (patch: Partial<QuickNoteItem>): QuickNoteItem => ({
  content: '',
  createdAt: 1000,
  id: 'note-1',
  tags: [],
  updatedAt: 1000,
  ...patch,
});

beforeEach(() => {
  useQuickNoteStore.getState().reset();
  useQuickNoteStore.setState({ ...initialState });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFetchNotes', () => {
  /** @example A mounted surface loads the list through SWR and projects it into the store. */
  it('hydrates the store from the list request', async () => {
    const seeded = [createNoteItem({ id: 'seeded' })];
    vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue(page(seeded));

    renderHook(() => useQuickNoteStore((s) => s.useFetchNotes)(), { wrapper });

    await waitFor(() => expect(useQuickNoteStore.getState().notesInit).toBe(true));
    expect(useQuickNoteStore.getState().notes).toEqual(seeded);
    expect(useQuickNoteStore.getState().notesLoadError).toBe(false);
  });

  /** @example A second surface mounting later does not overwrite edits made after the first load. */
  it('keeps local edits when another surface mounts', async () => {
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValue(page([createNoteItem({ content: 'server', id: 'a' })]));

    renderHook(() => useQuickNoteStore((s) => s.useFetchNotes)(), { wrapper });
    await waitFor(() => expect(useQuickNoteStore.getState().notesInit).toBe(true));

    useQuickNoteStore.setState({ notes: [createNoteItem({ content: 'local edit', id: 'a' })] });
    renderHook(() => useQuickNoteStore((s) => s.useFetchNotes)(), { wrapper });
    await waitFor(() => expect(getNotes).toHaveBeenCalledTimes(2));

    expect(useQuickNoteStore.getState().notes[0].content).toBe('local edit');
  });

  /** @example A failed request settles the surface with a retryable error. */
  it('records a load failure', async () => {
    vi.spyOn(quickNoteService, 'getNotes').mockRejectedValue(new Error('offline'));

    renderHook(() => useQuickNoteStore((s) => s.useFetchNotes)(), { wrapper });

    await waitFor(() => expect(useQuickNoteStore.getState().notesLoadError).toBe(true));
    expect(useQuickNoteStore.getState().notesInit).toBe(true);
  });

  /** @example A scope reset gives the mounted surface a new list entry, so it loads the new scope. */
  it('reloads after a store reset', async () => {
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValueOnce(page([createNoteItem({ id: 'old-scope' })]))
      .mockResolvedValueOnce(page([createNoteItem({ id: 'new-scope' })]));

    const view = renderHook(() => useQuickNoteStore((s) => s.useFetchNotes)(), { wrapper });
    await waitFor(() => expect(useQuickNoteStore.getState().notes[0]?.id).toBe('old-scope'));

    useQuickNoteStore.getState().reset();
    view.rerender();

    await waitFor(() => expect(useQuickNoteStore.getState().notes[0]?.id).toBe('new-scope'));
    expect(getNotes).toHaveBeenCalledTimes(2);
  });
});

describe('useFetchNote', () => {
  /** @example A link to a note outside the loaded pages still opens that note. */
  it('adds a note that no loaded page contains', async () => {
    useQuickNoteStore.setState({ notes: [createNoteItem({ id: 'recent' })], notesInit: true });
    const getNote = vi
      .spyOn(quickNoteService, 'getNote')
      .mockResolvedValue(createNoteItem({ content: 'older', id: 'older' }));

    renderHook(() => useQuickNoteStore((s) => s.useFetchNote)('older'), { wrapper });

    await waitFor(() =>
      expect(useQuickNoteStore.getState().notes.map(({ id }) => id)).toEqual(['recent', 'older']),
    );
    expect(getNote).toHaveBeenCalledWith('older');
  });
});
