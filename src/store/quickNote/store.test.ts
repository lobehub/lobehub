import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type QuickNoteItem, quickNoteService } from '@/services/quickNote';

import { AUTO_TAG_DELAY, PERSIST_DEBOUNCE } from './action';
import { initialState, type QuickNoteState } from './initialState';
import { quickNoteSelectors } from './selectors';
import { useQuickNoteStore } from './store';

const createNoteItem = (patch: Partial<QuickNoteItem>): QuickNoteItem => ({
  content: '',
  createdAt: 1000,
  id: 'note-1',
  tags: [],
  updatedAt: 1000,
  ...patch,
});

const resetStore = (patch?: Partial<QuickNoteState>) => {
  useQuickNoteStore.setState({ ...initialState, ...patch });
};

describe('quickNoteSelectors', () => {
  const notes: QuickNoteItem[] = [
    createNoteItem({ collection: 'Research', content: 'agent 调研', id: 'a', tags: ['Research'] }),
    createNoteItem({
      collection: 'Tasks & bugs',
      content: '[截图] leave comment 会被吞掉',
      createdAt: 3000,
      id: 'b',
      tags: ['Bug', '截图'],
    }),
    createNoteItem({ content: '口语有点差', createdAt: 2000, id: 'c', tags: ['表达'] }),
  ];

  const state = { ...initialState, notes } as QuickNoteState;

  it('filters by collection', () => {
    const filtered = quickNoteSelectors.filteredNotes({ ...state, activeCollection: 'Research' });
    expect(filtered.map((note) => note.id)).toEqual(['a']);
  });

  it('filters uncategorized notes', () => {
    const filtered = quickNoteSelectors.filteredNotes({
      ...state,
      activeCollection: 'uncategorized',
    });
    expect(filtered.map((note) => note.id)).toEqual(['c']);
  });

  it('filters by tag', () => {
    const filtered = quickNoteSelectors.filteredNotes({ ...state, activeTag: 'Bug' });
    expect(filtered.map((note) => note.id)).toEqual(['b']);
  });

  it('filters by search keywords case-insensitively', () => {
    const filtered = quickNoteSelectors.filteredNotes({ ...state, searchKeywords: 'AGENT' });
    expect(filtered.map((note) => note.id)).toEqual(['a']);
  });

  it('sorts filtered notes by createdAt desc', () => {
    const filtered = quickNoteSelectors.filteredNotes(state);
    expect(filtered.map((note) => note.id)).toEqual(['b', 'c', 'a']);
  });

  it('aggregates collections and tags with counts', () => {
    expect(quickNoteSelectors.collections(state)).toEqual([
      { count: 1, name: 'Research' },
      { count: 1, name: 'Tasks & bugs' },
    ]);
    expect(quickNoteSelectors.uncategorizedCount(state)).toBe(1);
    expect(quickNoteSelectors.tags(state)).toEqual([
      { count: 1, name: 'Bug' },
      { count: 1, name: 'Research' },
      { count: 1, name: '截图' },
      { count: 1, name: '表达' },
    ]);
  });
});

describe('quickNote actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    vi.spyOn(quickNoteService, 'saveNotes').mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initNotes loads from the service only once', async () => {
    const seeded = [createNoteItem({ id: 'seeded' })];
    const getNotes = vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue(seeded);

    await useQuickNoteStore.getState().initNotes();
    await useQuickNoteStore.getState().initNotes();

    expect(getNotes).toHaveBeenCalledTimes(1);
    expect(useQuickNoteStore.getState().notes).toEqual(seeded);
    expect(useQuickNoteStore.getState().notesInit).toBe(true);
  });

  it('createNote prepends a note and persists after debounce', async () => {
    const id = await useQuickNoteStore.getState().createNote();

    expect(useQuickNoteStore.getState().notes[0].id).toBe(id);

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(quickNoteService.saveNotes).toHaveBeenCalledWith(useQuickNoteStore.getState().notes);
  });

  it('updateNoteContent tracks save status through the debounce window', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    expect(useQuickNoteStore.getState().saveStatus).toBe('saving');
    expect(useQuickNoteStore.getState().notes[0].content).toBe('hello');

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('saved');
  });

  it('marks the save as failed when persistence throws', async () => {
    vi.spyOn(quickNoteService, 'saveNotes').mockRejectedValue(new Error('quota exceeded'));
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('failed');
  });

  it('retrySave flushes immediately and recovers to saved', async () => {
    const saveNotes = vi
      .spyOn(quickNoteService, 'saveNotes')
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue();
    resetStore({ notes: [createNoteItem({ id: 'a', tags: ['manual'] })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('failed');

    useQuickNoteStore.getState().retrySave();
    await vi.runAllTimersAsync();

    expect(saveNotes).toHaveBeenCalledTimes(2);
    expect(useQuickNoteStore.getState().saveStatus).toBe('saved');
  });

  it('auto-tags an untagged note after the settle delay', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', '[截图] 这个 bug 不对');

    await vi.advanceTimersByTimeAsync(AUTO_TAG_DELAY + PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().notes[0].tags).toEqual(['截图', 'Bug']);
  });

  it('keeps existing tags untouched by auto-tagging', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a', tags: ['manual'] })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', '新内容');

    await vi.advanceTimersByTimeAsync(AUTO_TAG_DELAY + PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().notes[0].tags).toEqual(['manual']);
  });

  it('diveInto streams an annotation to completion', async () => {
    resetStore({ notes: [createNoteItem({ content: '记一下', id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().diveInto('a');
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(true);

    await vi.runAllTimersAsync();

    const state = useQuickNoteStore.getState();
    expect(quickNoteSelectors.isDiving('a')(state)).toBe(false);
    expect(state.notes[0].annotation?.divedAt).toBeTruthy();
    expect(state.notes[0].annotation?.content).toContain('记一下');
  });

  it('diveInto ignores empty notes', () => {
    resetStore({ notes: [createNoteItem({ content: '   ', id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().diveInto('a');
    expect(useQuickNoteStore.getState().divingNoteIds).toEqual([]);
  });

  it('toggleAnnotationPanel flips and accepts an explicit target', () => {
    expect(useQuickNoteStore.getState().annotationPanelExpanded).toBe(true);

    useQuickNoteStore.getState().toggleAnnotationPanel();
    expect(useQuickNoteStore.getState().annotationPanelExpanded).toBe(false);

    useQuickNoteStore.getState().toggleAnnotationPanel(true);
    expect(useQuickNoteStore.getState().annotationPanelExpanded).toBe(true);
  });

  it('collection and tag filters are mutually exclusive', () => {
    useQuickNoteStore.getState().setActiveTag('Bug');
    expect(useQuickNoteStore.getState().activeTag).toBe('Bug');

    useQuickNoteStore.getState().setActiveCollection('Research');
    expect(useQuickNoteStore.getState().activeCollection).toBe('Research');
    expect(useQuickNoteStore.getState().activeTag).toBeNull();
  });

  it('removeNote clears the active note when it is deleted', async () => {
    resetStore({ activeNoteId: 'a', notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().removeNote('a');

    expect(useQuickNoteStore.getState().notes).toEqual([]);
    expect(useQuickNoteStore.getState().activeNoteId).toBeUndefined();
  });
});
