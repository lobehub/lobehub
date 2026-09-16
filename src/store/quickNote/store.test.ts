import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type QuickNoteItem, type QuickNoteProposal, quickNoteService } from '@/services/quickNote';

import {
  ANALYZE_POLL_INTERVAL,
  ANALYZE_SETTLE_DELAY,
  DIVE_POLL_INTERVAL,
  PERSIST_DEBOUNCE,
} from './action';
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

  it('pendingProposalsById returns only pending proposals', () => {
    const createProposal = (patch: Partial<QuickNoteProposal>): QuickNoteProposal => ({
      content: '',
      createdAt: 1000,
      decisionStatus: 'pending',
      id: 'proposal-1',
      kind: 'task',
      updatedAt: 1000,
      validity: 'current',
      ...patch,
    });
    const withDetails = {
      ...state,
      agenticDetailMap: {
        a: {
          comments: [],
          proposals: [
            createProposal({ decisionStatus: 'pending', id: 'p1' }),
            createProposal({ decisionStatus: 'accepted', id: 'p2' }),
            createProposal({ decisionStatus: 'dismissed', id: 'p3' }),
          ],
          resources: [],
        },
      },
    } as QuickNoteState;

    expect(
      quickNoteSelectors
        .pendingProposalsById('a')(withDetails)
        .map((p) => p.id),
    ).toEqual(['p1']);
    expect(quickNoteSelectors.pendingProposalsById('missing')(withDetails)).toEqual([]);
  });
});

describe('quickNote actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    vi.spyOn(quickNoteService, 'analyze').mockResolvedValue({ accepted: false });
    vi.spyOn(quickNoteService, 'createNote').mockResolvedValue(createNoteItem({ id: 'created' }));
    vi.spyOn(quickNoteService, 'dive').mockResolvedValue({
      id: 'run-1',
      kind: 'dive',
      operationId: 'op-1',
      status: 'running',
    } as Awaited<ReturnType<typeof quickNoteService.dive>>);
    vi.spyOn(quickNoteService, 'removeNote').mockResolvedValue();
    vi.spyOn(quickNoteService, 'updateNoteContent').mockImplementation(async () => ({
      analyzeDueAt: Date.now() + ANALYZE_SETTLE_DELAY,
    }));
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

  /** @example A rejected list request settles the UI and can be retried. */
  it('records an initialization error and retries it', async () => {
    const seeded = [createNoteItem({ id: 'recovered' })];
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(seeded);

    await useQuickNoteStore.getState().initNotes();

    /** @example The list leaves its loading skeleton after a failed request. */
    expect(useQuickNoteStore.getState().notesInit).toBe(true);
    /** @example The shared list surfaces receive a retryable error flag. */
    expect(useQuickNoteStore.getState().notesLoadError).toBe(true);

    await useQuickNoteStore.getState().initNotes();

    /** @example Retry replaces the failure state with the server result. */
    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(useQuickNoteStore.getState().notes).toEqual(seeded);
    expect(useQuickNoteStore.getState().notesLoadError).toBe(false);
  });

  /** @example An active Dive restored from the server keeps polling until its operation finishes. */
  it('resumes polling an active Dive after initialization', async () => {
    const running = createNoteItem({
      content: '恢复 Dive',
      id: 'active-dive',
      run: { kind: 'dive', operationId: 'op-1', status: 'running' },
    });
    const completed = {
      ...running,
      annotation: { content: '已完成', divedAt: 2000 },
      run: { ...running.run!, status: 'completed' as const },
    };
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValueOnce([running])
      .mockResolvedValueOnce([completed]);

    await useQuickNoteStore.getState().initNotes();
    await vi.advanceTimersByTimeAsync(DIVE_POLL_INTERVAL);

    /** @example Refresh recovery performs a follow-up status request. */
    expect(getNotes).toHaveBeenCalledTimes(2);
    /** @example The recovered terminal projection leaves the note out of the active Dive set. */
    expect(useQuickNoteStore.getState().divingNoteIds).toEqual([]);
    /** @example The accepted Annotation is projected into the existing panel state. */
    expect(useQuickNoteStore.getState().notes[0].annotation?.content).toBe('已完成');
  });

  it('createNote prepends the server-created note', async () => {
    const id = await useQuickNoteStore.getState().createNote('saved at creation', { revision: 1 });

    expect(useQuickNoteStore.getState().notes[0].id).toBe(id);
    expect(quickNoteService.createNote).toHaveBeenCalledWith('saved at creation', { revision: 1 });
  });

  /** @example Route teardown flushes a pending editor revision before the debounce expires. */
  it('flushes pending editor writes on demand', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'leaving now', { revision: 2 });
    await useQuickNoteStore.getState().flushPendingWrites();

    /** @example The server receives the pending revision without advancing the debounce timer. */
    expect(quickNoteService.updateNoteContent).toHaveBeenCalledWith('a', 'leaving now', {
      revision: 2,
    });
  });

  it('updateNoteContent tracks save status through the debounce window', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    expect(useQuickNoteStore.getState().saveStatus).toBe('saving');
    expect(useQuickNoteStore.getState().notes[0].content).toBe('hello');

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('saved');
    expect(quickNoteService.updateNoteContent).toHaveBeenCalledWith('a', 'hello', {
      markdown: 'hello',
    });
  });

  /** @example A saved Quick Note requests Analyze after six seconds without further edits. */
  it('claims Analyze after the configured quiet period', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    await vi.advanceTimersByTimeAsync(ANALYZE_SETTLE_DELAY - 1);

    /** @example The Agent is not claimed before the complete quiet period elapses. */
    expect(quickNoteService.analyze).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    /** @example The latest saved Quick Note is claimed when the quiet period elapses. */
    expect(quickNoteService.analyze).toHaveBeenCalledWith('a', 'automatic');
  });

  /** @example Completed background Analyze appears in the open note without a reload. */
  it('polls an accepted Analyze claim until its Annotation is projected', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });
    vi.spyOn(quickNoteService, 'analyze').mockResolvedValue({
      accepted: true,
      run: {
        id: 'run-1',
        kind: 'analyze',
        quickNoteId: 'a',
        sourceHistoryId: 'history-1',
        status: 'pending',
      },
    } as Awaited<ReturnType<typeof quickNoteService.analyze>>);
    const completed = createNoteItem({
      annotation: { content: '轻量理解', divedAt: 2000 },
      content: 'hello',
      id: 'a',
      run: { kind: 'analyze', operationId: 'op-1', status: 'completed' },
    });
    vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue([completed]);

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + ANALYZE_SETTLE_DELAY);
    await vi.advanceTimersByTimeAsync(ANALYZE_POLL_INTERVAL);

    /** @example The accepted Annotation replaces the pre-Run local projection. */
    expect(useQuickNoteStore.getState().notes[0].annotation?.content).toBe('轻量理解');
  });

  /** @example Clicking Analyze saves the visible revision before requesting a manual Run. */
  it('flushes the latest editor revision before manual Analyze', async () => {
    resetStore({ notes: [createNoteItem({ content: '旧内容', id: 'a' })], notesInit: true });
    vi.spyOn(quickNoteService, 'analyze').mockResolvedValue({
      accepted: true,
      run: {
        id: 'run-1',
        kind: 'analyze',
        quickNoteId: 'a',
        sourceHistoryId: 'history-1',
        status: 'pending',
      },
    } as Awaited<ReturnType<typeof quickNoteService.analyze>>);

    useQuickNoteStore.getState().updateNoteContent('a', '最新内容', { revision: 2 });
    await useQuickNoteStore.getState().analyzeNote('a');

    /** @example The manual action uses the explicit trigger and pins no stale editor content. */
    expect(quickNoteService.analyze).toHaveBeenCalledWith('a', 'manual');
    expect(vi.mocked(quickNoteService.updateNoteContent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(quickNoteService.analyze).mock.invocationCallOrder[0],
    );
    expect(useQuickNoteStore.getState().notes[0].run?.status).toBe('pending');
    expect(useQuickNoteStore.getState().notes[0].run?.trigger).toBe('manual');
  });

  /** @example Continuing to type cancels the countdown for the previously saved revision. */
  it('restarts Automatic Analysis countdown after a newer edit', async () => {
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'first');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    await vi.advanceTimersByTimeAsync(ANALYZE_SETTLE_DELAY - 500);
    useQuickNoteStore.getState().updateNoteContent('a', 'second');
    await vi.advanceTimersByTimeAsync(500);

    // ROOT CAUSE:
    //
    // The previous countdown used to remain live until the newer revision finished saving.
    // It could therefore claim the old Document revision while the user was still typing.
    //
    // We now cancel the scheduled claim as soon as a new editor change arrives.
    expect(quickNoteService.analyze).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + ANALYZE_SETTLE_DELAY);

    /** @example Only the quiet period belonging to the second saved revision can trigger. */
    expect(quickNoteService.analyze).toHaveBeenCalledTimes(1);
    expect(quickNoteService.analyze).toHaveBeenCalledWith('a', 'automatic');
  });

  /** @example A second edit arriving during the first request remains queued for persistence. */
  it('does not drop edits made while an earlier save is in flight', async () => {
    let resolveFirstSave: ((value: { analyzeDueAt?: number }) => void) | undefined;
    const updateNoteContent = vi
      .spyOn(quickNoteService, 'updateNoteContent')
      .mockImplementationOnce(
        () =>
          new Promise<{ analyzeDueAt?: number }>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValue({});
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'first', { revision: 1 });
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    useQuickNoteStore.getState().updateNoteContent('a', 'second', { revision: 2 });
    resolveFirstSave?.({});
    await Promise.resolve();

    /** @example Completing the stale request does not report the newer edit as saved. */
    expect(useQuickNoteStore.getState().saveStatus).toBe('saving');

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);

    /** @example Both source revisions reach the service in order. */
    expect(updateNoteContent).toHaveBeenNthCalledWith(1, 'a', 'first', { revision: 1 });
    expect(updateNoteContent).toHaveBeenNthCalledWith(2, 'a', 'second', { revision: 2 });
    expect(useQuickNoteStore.getState().saveStatus).toBe('saved');
  });

  it('marks the save as failed when persistence throws', async () => {
    vi.spyOn(quickNoteService, 'updateNoteContent').mockRejectedValue(new Error('offline'));
    resetStore({ notes: [createNoteItem({ id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('failed');
  });

  it('retrySave flushes immediately and recovers to saved', async () => {
    const updateNoteContent = vi
      .spyOn(quickNoteService, 'updateNoteContent')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({});
    resetStore({ notes: [createNoteItem({ id: 'a', tags: ['manual'] })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('failed');

    useQuickNoteStore.getState().retrySave();
    await vi.runAllTimersAsync();

    expect(updateNoteContent).toHaveBeenCalledTimes(2);
    expect(useQuickNoteStore.getState().saveStatus).toBe('saved');
  });

  it('diveInto recovers the completed Annotation from server state', async () => {
    resetStore({ notes: [createNoteItem({ content: '记一下', id: 'a' })], notesInit: true });
    vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue([
      createNoteItem({
        annotation: { content: '解释', divedAt: 2000 },
        content: '记一下',
        id: 'a',
        run: { kind: 'dive', operationId: 'op-1', status: 'completed' },
      }),
    ]);

    await useQuickNoteStore.getState().diveInto('a');
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(true);

    await vi.advanceTimersByTimeAsync(DIVE_POLL_INTERVAL);

    const state = useQuickNoteStore.getState();
    expect(quickNoteSelectors.isDiving('a')(state)).toBe(false);
    expect(state.notes[0].annotation?.divedAt).toBeTruthy();
    expect(state.notes[0].annotation?.content).toBe('解释');
  });

  /** @example A terminal status visible before its completion projection triggers a bounded retry. */
  it('reconciles a terminal Dive whose Annotation becomes visible on the next poll', async () => {
    resetStore({ notes: [createNoteItem({ content: '记一下', id: 'a' })], notesInit: true });
    const terminalWithoutProjection = createNoteItem({
      content: '记一下',
      id: 'a',
      run: { kind: 'dive', operationId: 'op-1', status: 'completed' },
    });
    const terminalWithProjection = createNoteItem({
      ...terminalWithoutProjection,
      annotation: { content: '最终解释', divedAt: 3000 },
    });
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValueOnce([terminalWithoutProjection])
      .mockResolvedValueOnce([terminalWithProjection]);

    await useQuickNoteStore.getState().diveInto('a');
    await vi.advanceTimersByTimeAsync(DIVE_POLL_INTERVAL);

    // ROOT CAUSE:
    //
    // A completion-status read can win the race against the asynchronous completion projection.
    // The old behavior stopped polling immediately and left the Annotation panel stale until reload.
    //
    // We keep the Dive pending for a bounded reconciliation read when its projection is absent.
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(true);
    expect(useQuickNoteStore.getState().notes[0].annotation).toBeUndefined();

    await vi.advanceTimersByTimeAsync(DIVE_POLL_INTERVAL);

    /** @example The second read accepts the completed projection without a page reload. */
    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(false);
    expect(useQuickNoteStore.getState().notes[0].annotation?.content).toBe('最终解释');
  });

  /** @example A repeated Dive waits for a newer Annotation instead of accepting the previous one. */
  it('reconciles a repeated Dive while its previous Annotation is still visible', async () => {
    const previousAnnotation = { content: '上一次解释', divedAt: 2000 };
    resetStore({
      notes: [createNoteItem({ annotation: previousAnnotation, content: '再分析一次', id: 'a' })],
      notesInit: true,
    });
    const terminalWithPreviousProjection = createNoteItem({
      annotation: previousAnnotation,
      content: '再分析一次',
      id: 'a',
      run: { kind: 'dive', operationId: 'op-2', status: 'completed' },
    });
    const terminalWithCurrentProjection = createNoteItem({
      ...terminalWithPreviousProjection,
      annotation: { content: '本次解释', divedAt: 3000 },
    });
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValueOnce([terminalWithPreviousProjection])
      .mockResolvedValueOnce([terminalWithCurrentProjection]);

    await useQuickNoteStore.getState().diveInto('a');
    await vi.advanceTimersByTimeAsync(DIVE_POLL_INTERVAL);

    // ROOT CAUSE:
    //
    // Presence-only reconciliation mistakes the previous Dive's Annotation for the current result.
    // That can stop polling before the completion hook projects the new Annotation.
    //
    // We pin the pre-Dive Annotation timestamp and wait until the projection advances.
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(true);
    expect(useQuickNoteStore.getState().notes[0].annotation?.content).toBe('上一次解释');

    await vi.advanceTimersByTimeAsync(DIVE_POLL_INTERVAL);

    /** @example A newer projection completes the repeated Dive without requiring a page reload. */
    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(false);
    expect(useQuickNoteStore.getState().notes[0].annotation?.content).toBe('本次解释');
  });

  /** @example Dive flushes a pending rich-text revision before the server claims its snapshot. */
  it('persists the latest editor revision before starting Dive', async () => {
    resetStore({ notes: [createNoteItem({ content: '旧内容', id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', '最新内容', { revision: 2 });
    await useQuickNoteStore.getState().diveInto('a');

    /** @example Persistence precedes the Dive mutation against the same Quick Note. */
    expect(quickNoteService.updateNoteContent).toHaveBeenCalledWith('a', '最新内容', {
      revision: 2,
    });
    /** @example The server cannot pin a stale revision before the editor save completes. */
    expect(vi.mocked(quickNoteService.updateNoteContent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(quickNoteService.dive).mock.invocationCallOrder[0],
    );
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

  it('removeNote clears the active note after the server delete succeeds', async () => {
    resetStore({ activeNoteId: 'a', notes: [createNoteItem({ id: 'a' })], notesInit: true });

    await useQuickNoteStore.getState().removeNote('a');

    expect(useQuickNoteStore.getState().notes).toEqual([]);
    expect(useQuickNoteStore.getState().activeNoteId).toBeUndefined();
  });
});
