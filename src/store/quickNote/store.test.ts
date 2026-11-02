import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type QuickNoteItem, type QuickNoteProposal, quickNoteService } from '@/services/quickNote';

import {
  ANALYZE_POLL_INTERVAL,
  ANALYZE_SETTLE_DELAY,
  PERSIST_DEBOUNCE,
  STALE_CHECK_REFRESH_DELAYS,
} from './action';
import { initialState, type QuickNoteState } from './initialState';
import { TASK_STATUS_REFRESH_DELAYS } from './proposalAction';
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

const page = (
  items: QuickNoteItem[],
  nextCursor: { createdAt: string; id: string } | null = null,
) => ({
  items,
  nextCursor,
});

const resetStore = (patch?: Partial<QuickNoteState>) => {
  useQuickNoteStore.getState().reset();
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

  /** @example Stale proposals stay actionable; superseded and decided ones move to history. */
  it('splits actionable and archived proposals', () => {
    const createProposal = (patch: Partial<QuickNoteProposal>): QuickNoteProposal => ({
      createdAt: 1000,
      decisionStatus: 'pending',
      id: 'proposal-1',
      kind: 'task',
      originalPayload: {},
      payload: {},
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
            createProposal({ decisionStatus: 'pending', id: 'p4', validity: 'stale' }),
            createProposal({ decisionStatus: 'pending', id: 'p5', validity: 'superseded' }),
          ],
          resources: [],
        },
      },
    } as QuickNoteState;

    expect(
      quickNoteSelectors
        .actionableProposalsById('a')(withDetails)
        .map((p) => p.id),
    ).toEqual(['p1', 'p4']);
    expect(
      quickNoteSelectors
        .archivedProposalsById('a')(withDetails)
        .map((p) => p.id),
    ).toEqual(['p2', 'p3', 'p5']);
    expect(quickNoteSelectors.actionableProposalsById('missing')(withDetails)).toEqual([]);
  });
});

describe('quickNote actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    vi.spyOn(quickNoteService, 'analyze').mockResolvedValue({ accepted: false });
    vi.spyOn(quickNoteService, 'createNote').mockResolvedValue(createNoteItem({ id: 'created' }));
    vi.spyOn(quickNoteService, 'dive').mockResolvedValue({ taskId: 'task-1' });
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

  /** @example Home captures honor their server-issued analysis deadline. */
  it('schedules automatic analysis for a newly created capture', async () => {
    vi.mocked(quickNoteService.createNote).mockResolvedValue(
      createNoteItem({ id: 'created', analyzeDueAt: Date.now() + 6000 }),
    );
    await useQuickNoteStore.getState().createNote('captured');
    await vi.advanceTimersByTimeAsync(6000);
    /** @example No second edit is needed to start the automatic claim. */
    expect(quickNoteService.analyze).toHaveBeenCalledWith('created', 'automatic');
  });

  /** @example Outages progressively reduce status traffic. */
  it('backs off consecutive polling failures', async () => {
    const note = createNoteItem({ run: { kind: 'analyze', status: 'running' } });
    vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue(page([note]));
    const getNote = vi.spyOn(quickNoteService, 'getNote').mockRejectedValue(new Error('offline'));
    await useQuickNoteStore.getState().initNotes();
    await vi.advanceTimersByTimeAsync(15000);
    /** @example Requests occur at 1, 3, 7 and 15 seconds, not every second. */
    expect(getNote).toHaveBeenCalledTimes(4);
  });

  // ROOT CAUSE:
  // Each active Analyze observation re-read the whole note list (every note with its full body)
  // once a second, so polling cost grew with the number of notes the user kept.
  /** @example Polling an active run reads only that note, never the list. */
  it('polls only the observed note', async () => {
    const running = createNoteItem({ id: 'running', run: { kind: 'analyze', status: 'running' } });
    const other = createNoteItem({ content: 'untouched', id: 'other' });
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValue(page([running, other]));
    const getNote = vi
      .spyOn(quickNoteService, 'getNote')
      .mockResolvedValue({ ...running, run: { kind: 'analyze', status: 'completed' } });
    vi.spyOn(quickNoteService, 'getAgenticDetails').mockResolvedValue({
      comments: [],
      proposals: [],
      resources: [],
    });
    vi.spyOn(quickNoteService, 'listTasks').mockResolvedValue([]);
    await useQuickNoteStore.getState().initNotes();

    await vi.advanceTimersByTimeAsync(ANALYZE_POLL_INTERVAL);

    expect(getNotes).toHaveBeenCalledTimes(1);
    expect(getNote).toHaveBeenCalledWith('running');
    expect(useQuickNoteStore.getState().notes.map(({ id, run }) => [id, run?.status])).toEqual([
      ['running', 'completed'],
      ['other', undefined],
    ]);
  });

  /** @example The list loads in pages; later pages append without replacing local notes. */
  it('appends the next list page and stops at the last one', async () => {
    const cursor = { createdAt: '2026-01-01T00:00:00.000Z', id: 'b' };
    const getNotes = vi
      .spyOn(quickNoteService, 'getNotes')
      .mockResolvedValueOnce(
        page([createNoteItem({ id: 'a' }), createNoteItem({ id: 'b' })], cursor),
      )
      .mockResolvedValueOnce(
        page([createNoteItem({ id: 'b', content: 'dup' }), createNoteItem({ id: 'c' })]),
      );
    await useQuickNoteStore.getState().initNotes();
    expect(useQuickNoteStore.getState().notesHasMore).toBe(true);

    await useQuickNoteStore.getState().loadMoreNotes();
    await useQuickNoteStore.getState().loadMoreNotes();

    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(getNotes).toHaveBeenLastCalledWith(cursor);
    expect(useQuickNoteStore.getState().notes.map(({ id, content }) => [id, content])).toEqual([
      ['a', ''],
      ['b', ''],
      ['c', ''],
    ]);
    expect(useQuickNoteStore.getState().notesHasMore).toBe(false);
  });

  /** @example Inactive surfaces suspend requests and resume their pending runs on return. */
  it('pauses polling and resumes without losing the active run', async () => {
    const note = createNoteItem({ run: { kind: 'analyze', status: 'running' } });
    vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue(page([note]));
    const getNote = vi.spyOn(quickNoteService, 'getNote').mockResolvedValue(note);
    await useQuickNoteStore.getState().initNotes();
    useQuickNoteStore.getState().setPollingActive(false);
    await vi.advanceTimersByTimeAsync(60000);
    /** @example No status requests are made while the surface is inactive. */
    expect(getNote).toHaveBeenCalledTimes(0);
    useQuickNoteStore.getState().setPollingActive(true);
    await vi.advanceTimersByTimeAsync(1000);
    /** @example Returning resumes the existing run. */
    expect(getNote).toHaveBeenCalledTimes(1);
  });

  /** @example Status polling preserves another note's unsaved editor projection. */
  it.each(['analyze', 'signal_enrichment'] as const)(
    'preserves pending edits while %s polls',
    async (kind) => {
      // ROOT CAUSE:
      // Polling replaced all notes with server text before the debounce saved local editor JSON.
      // Reconciliation must preserve pending edits on every note, not only the running note.
      const running = createNoteItem({ id: 'polling', run: { kind, status: 'running' } });
      const editing = createNoteItem({
        id: 'editing',
        content: 'old',
        editorData: { revision: 0 },
      });
      vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue(page([running, editing]));
      vi.spyOn(quickNoteService, 'getNote').mockResolvedValue(running);
      await useQuickNoteStore.getState().initNotes();
      await vi.advanceTimersByTimeAsync(500);
      useQuickNoteStore.getState().updateNoteContent('editing', 'new', { revision: 1 });
      await vi.advanceTimersByTimeAsync(500);
      /** @example The poll cannot combine old server text with the new editor payload. */
      expect(useQuickNoteStore.getState().notes.find(({ id }) => id === 'editing')).toMatchObject({
        content: 'new',
        editorData: { revision: 1 },
      });
      await useQuickNoteStore.getState().flushPendingWrites();
      /** @example Durable text and editor JSON describe the same revision. */
      expect(quickNoteService.updateNoteContent).toHaveBeenCalledWith('editing', 'new', {
        revision: 1,
      });
    },
  );

  /** @example A delayed poll cannot undo an edit acknowledged while the poll was in flight. */
  it('preserves an acknowledged edit against an older in-flight poll response', async () => {
    const note = createNoteItem({
      id: 'late-poll',
      content: 'old',
      run: { kind: 'analyze', status: 'running' },
    });
    let resolvePoll!: (note: QuickNoteItem) => void;
    vi.spyOn(quickNoteService, 'getNotes').mockResolvedValueOnce(page([note]));
    vi.spyOn(quickNoteService, 'getNote').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    await useQuickNoteStore.getState().initNotes();
    await vi.advanceTimersByTimeAsync(ANALYZE_POLL_INTERVAL);
    useQuickNoteStore.getState().updateNoteContent(note.id, 'saved while polling', { revision: 2 });
    await useQuickNoteStore.getState().flushPendingWrites();
    resolvePoll(note);
    await vi.advanceTimersByTimeAsync(0);
    /** @example An acknowledged local revision still wins over a stale request. */
    expect(useQuickNoteStore.getState().notes[0]).toMatchObject({
      content: 'saved while polling',
      editorData: { revision: 2 },
    });
  });

  /** @example Switching scope cancels pending saves and hydrates the new note list. */
  it('resets hydrated notes and cancels old-scope timers and saves', async () => {
    const old = createNoteItem({
      id: 'old-scope',
      content: 'private',
      run: { kind: 'analyze', status: 'running' },
    });
    vi.spyOn(quickNoteService, 'getNotes')
      .mockResolvedValueOnce(page([old]))
      .mockResolvedValueOnce(page([createNoteItem({ id: 'new-scope' })]));
    await useQuickNoteStore.getState().initNotes();
    useQuickNoteStore.getState().updateNoteContent(old.id, 'unsaved', { revision: 1 });
    useQuickNoteStore.getState().reset();
    /** @example Private data is cleared synchronously before the new request. */
    expect(useQuickNoteStore.getState().notes).toEqual([]);
    await useQuickNoteStore.getState().initNotes();
    await vi.advanceTimersByTimeAsync(10_000);
    /** @example No old-scope save is sent with the new scope's request headers. */
    expect(quickNoteService.updateNoteContent).not.toHaveBeenCalled();
    /** @example Initialization is allowed again in the new scope. */
    expect(useQuickNoteStore.getState().notes[0].id).toBe('new-scope');
  });

  /** @example A slow response from an old scope cannot repopulate a reset store. */
  it('discards a note-list response arriving after scope reset', async () => {
    let resolveOld!: (notes: ReturnType<typeof page>) => void;
    vi.spyOn(quickNoteService, 'getNotes')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(page([createNoteItem({ id: 'current-scope' })]));
    const oldRequest = useQuickNoteStore.getState().initNotes();
    useQuickNoteStore.getState().reset();
    await useQuickNoteStore.getState().initNotes();
    resolveOld(
      page([createNoteItem({ id: 'private-old', run: { kind: 'analyze', status: 'running' } })]),
    );
    await oldRequest;
    await vi.advanceTimersByTimeAsync(ANALYZE_POLL_INTERVAL);
    /** @example The old response neither replaces the new list nor restarts old polling. */
    expect(useQuickNoteStore.getState().notes.map(({ id }) => id)).toEqual(['current-scope']);
    /** @example Only one hydration request per scope was made. */
    expect(quickNoteService.getNotes).toHaveBeenCalledTimes(2);
  });

  it('initNotes loads from the service only once', async () => {
    const seeded = [createNoteItem({ id: 'seeded' })];
    const getNotes = vi.spyOn(quickNoteService, 'getNotes').mockResolvedValue(page(seeded));

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
      .mockResolvedValueOnce(page(seeded));

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
  it('polls an accepted Analyze claim until its summary is projected', async () => {
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
      content: 'hello',
      summary: { completedAt: 2000, content: '轻量理解' },
      id: 'a',
      run: { kind: 'analyze', operationId: 'op-1', status: 'completed' },
    });
    vi.spyOn(quickNoteService, 'getNote').mockResolvedValue(completed);

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE + ANALYZE_SETTLE_DELAY);
    await vi.advanceTimersByTimeAsync(ANALYZE_POLL_INTERVAL);

    /** @example The new summary replaces the pre-Run local projection. */
    expect(useQuickNoteStore.getState().notes[0].summary?.content).toBe('轻量理解');
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
    vi.spyOn(quickNoteService, 'getNote').mockResolvedValue(createNoteItem({ id: 'a' }));
    await vi.advanceTimersByTimeAsync(ANALYZE_SETTLE_DELAY + 1000);
    /** @example The post-flush automatic timer cannot launch a second run. */
    expect(quickNoteService.analyze).toHaveBeenCalledTimes(1);
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

  /** @example An older save never lands after a newer one. */
  it('sends the next save of a note only after the previous one settles', async () => {
    // ROOT CAUSE:
    // A save fired after the debounce while the previous request was still in flight. The server
    // keeps the last write it receives, so a slow older revision could overwrite the newer one.
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
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);

    /** @example The newer revision waits while the older request is in flight. */
    expect(updateNoteContent).toHaveBeenCalledTimes(1);

    resolveFirstSave?.({});
    await vi.advanceTimersByTimeAsync(0);

    /** @example It is sent once the older request has settled. */
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
    resetStore({
      notes: [
        createNoteItem({ id: 'a', tags: ['manual'] }),
        createNoteItem({ id: 'untouched', editorData: { revision: 1 } }),
      ],
      notesInit: true,
    });

    useQuickNoteStore.getState().updateNoteContent('a', 'hello');
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    expect(useQuickNoteStore.getState().saveStatus).toBe('failed');

    useQuickNoteStore.getState().retrySave();
    await vi.runAllTimersAsync();

    expect(updateNoteContent).toHaveBeenCalledTimes(2);
    expect(useQuickNoteStore.getState().saveStatus).toBe('saved');
  });

  /** @example Dive starts a Task and hands its id back for navigation; the summary is untouched. */
  it('diveInto returns the created task and refreshes the task list', async () => {
    const summary = { completedAt: 2000, content: '概述' };
    resetStore({
      notes: [createNoteItem({ content: '记一下', id: 'a', summary })],
      notesInit: true,
    });
    const refreshTasks = vi.fn().mockResolvedValue(undefined);
    useQuickNoteStore.setState({ refreshTasks });

    const pending = useQuickNoteStore.getState().diveInto('a');
    /** @example The Dive button shows progress while the request is in flight. */
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(true);

    await expect(pending).resolves.toBe('task-1');
    expect(quickNoteService.dive).toHaveBeenCalledWith('a');
    expect(refreshTasks).toHaveBeenCalledWith('a');
    expect(quickNoteSelectors.isDiving('a')(useQuickNoteStore.getState())).toBe(false);
    /** @example Only the bounded Task-status re-read is scheduled; the summary is not replaced. */
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(useQuickNoteStore.getState().notes[0].summary).toEqual(summary);
  });

  /** @example A failed Dive clears its busy state and surfaces the error to the caller. */
  it('diveInto clears the busy state when the request fails', async () => {
    resetStore({ notes: [createNoteItem({ content: '记一下', id: 'a' })], notesInit: true });
    vi.mocked(quickNoteService.dive).mockRejectedValueOnce(new Error('boom'));

    await expect(useQuickNoteStore.getState().diveInto('a')).rejects.toThrow('boom');
    expect(useQuickNoteStore.getState().divingNoteIds).toEqual([]);
  });

  /** @example Dive flushes a pending rich-text revision before the server reads the note. */
  it('persists the latest editor revision before starting Dive', async () => {
    resetStore({ notes: [createNoteItem({ content: '旧内容', id: 'a' })], notesInit: true });

    useQuickNoteStore.getState().updateNoteContent('a', '最新内容', { revision: 2 });
    await useQuickNoteStore.getState().diveInto('a');

    /** @example Persistence precedes the Dive mutation against the same Quick Note. */
    expect(quickNoteService.updateNoteContent).toHaveBeenCalledWith('a', '最新内容', {
      revision: 2,
    });
    /** @example The Task cannot read a stale revision before the editor save completes. */
    expect(vi.mocked(quickNoteService.updateNoteContent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(quickNoteService.dive).mock.invocationCallOrder[0],
    );
  });

  it('diveInto ignores empty notes', async () => {
    resetStore({ notes: [createNoteItem({ content: '   ', id: 'a' })], notesInit: true });

    await expect(useQuickNoteStore.getState().diveInto('a')).resolves.toBeUndefined();
    expect(quickNoteService.dive).not.toHaveBeenCalled();
    expect(useQuickNoteStore.getState().divingNoteIds).toEqual([]);
  });

  describe('proposals', () => {
    const refreshAgenticDetails = vi.fn();
    const refreshTasks = vi.fn();

    beforeEach(() => {
      refreshAgenticDetails.mockReset().mockResolvedValue(undefined);
      refreshTasks.mockReset().mockResolvedValue(undefined);
      useQuickNoteStore.setState({ refreshAgenticDetails, refreshTasks });
    });

    /** @example Apply refreshes both the proposal list and the executed tasks. */
    it('applies a proposal once while it is processing', async () => {
      let resolveApply!: (
        value: Awaited<ReturnType<typeof quickNoteService.applyProposal>>,
      ) => void;
      const apply = vi.spyOn(quickNoteService, 'applyProposal').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveApply = resolve;
          }),
      );

      const first = useQuickNoteStore.getState().applyProposal('a', 'p1');
      /** @example A double click while busy does not apply twice. */
      await expect(useQuickNoteStore.getState().applyProposal('a', 'p1')).resolves.toBeUndefined();
      expect(quickNoteSelectors.isProcessingProposal('p1')(useQuickNoteStore.getState())).toBe(
        true,
      );

      const result = { applied: true, proposal: { id: 'p1' } } as Awaited<
        ReturnType<typeof quickNoteService.applyProposal>
      >;
      resolveApply(result);

      await expect(first).resolves.toBe(result);
      expect(apply).toHaveBeenCalledTimes(1);
      expect(refreshAgenticDetails).toHaveBeenCalledWith('a');
      expect(refreshTasks).toHaveBeenCalledWith('a');
      expect(useQuickNoteStore.getState().processingProposalIds).toEqual([]);
    });

    // ROOT CAUSE:
    // The Task starts after the apply response, so the one refresh right after apply still saw
    // `backlog` and 「已执行」 showed 待办 until a refocus.
    /** @example After a Task starts, its status is re-read until it leaves backlog. */
    it('re-reads started Tasks until they leave backlog', async () => {
      const task = (status: string) => ({
        createdAt: 1,
        id: 't1',
        identifier: 'T-1',
        proposalId: 'p1',
        runId: 'r1',
        status,
        updatedAt: 1,
      });
      useQuickNoteStore.setState({ taskMap: { a: [task('backlog')] } });
      vi.spyOn(quickNoteService, 'applyProposal').mockResolvedValue({
        applied: true,
        proposal: { id: 'p1', resultType: 'task' },
      } as Awaited<ReturnType<typeof quickNoteService.applyProposal>>);

      await useQuickNoteStore.getState().applyProposal('a', 'p1');
      expect(refreshTasks).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TASK_STATUS_REFRESH_DELAYS[0]);
      expect(refreshTasks).toHaveBeenCalledTimes(2);

      refreshTasks.mockImplementation(async () => {
        useQuickNoteStore.setState({ taskMap: { a: [task('running')] } });
      });
      await vi.advanceTimersByTimeAsync(TASK_STATUS_REFRESH_DELAYS[1]);
      expect(refreshTasks).toHaveBeenCalledTimes(3);
      expect(useQuickNoteStore.getState().taskMap.a[0].status).toBe('running');

      await vi.advanceTimersByTimeAsync(60_000);
      /** @example The re-reads are bounded. */
      expect(refreshTasks).toHaveBeenCalledTimes(3);
    });

    it('stops re-reading once the started Task is running', async () => {
      useQuickNoteStore.setState({ notes: [createNoteItem({ content: 'dive', id: 'a' })] });
      refreshTasks.mockImplementation(async () => {
        useQuickNoteStore.setState({
          taskMap: {
            a: [
              {
                createdAt: 1,
                id: 't1',
                identifier: 'T-1',
                proposalId: null,
                runId: null,
                status: 'running',
                updatedAt: 1,
              },
            ],
          },
        });
      });

      await useQuickNoteStore.getState().diveInto('a');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshTasks).toHaveBeenCalledTimes(2);
    });

    /** @example A conflict refreshes the stale sidebar and rethrows for the toast. */
    it('refreshes details and rethrows when apply fails', async () => {
      const conflict = Object.assign(new Error('dismissed'), { data: { code: 'CONFLICT' } });
      vi.spyOn(quickNoteService, 'applyProposal').mockRejectedValue(conflict);

      await expect(useQuickNoteStore.getState().applyProposal('a', 'p1')).rejects.toBe(conflict);
      expect(refreshAgenticDetails).toHaveBeenCalledWith('a');
      expect(useQuickNoteStore.getState().processingProposalIds).toEqual([]);
    });

    // ROOT CAUSE:
    // Only apply refreshed the sidebar on failure; a dismiss or edit of a Proposal that another
    // Run had already replaced left the stale card on screen after the error toast.
    /** @example A failed dismiss or edit refreshes the stale sidebar and rethrows for the toast. */
    it.each([
      ['dismissProposal', () => useQuickNoteStore.getState().dismissProposal('a', 'p1')],
      [
        'updateProposal',
        () => useQuickNoteStore.getState().updateProposal('a', 'p1', { instruction: 'x' }),
      ],
    ] as const)('refreshes details and rethrows when %s fails', async (method, run) => {
      const conflict = Object.assign(new Error('superseded'), { data: { code: 'CONFLICT' } });
      vi.spyOn(quickNoteService, method).mockRejectedValue(conflict);

      await expect(run()).rejects.toBe(conflict);
      expect(refreshAgenticDetails).toHaveBeenCalledWith('a');
      expect(useQuickNoteStore.getState().processingProposalIds).toEqual([]);
    });

    /** @example Every dismiss reason code reaches the server unchanged. */
    it.each(['not_now', 'not_wanted', 'duplicate', 'other', undefined] as const)(
      'dismisses with reason %s',
      async (reason) => {
        const dismiss = vi
          .spyOn(quickNoteService, 'dismissProposal')
          .mockResolvedValue({} as Awaited<ReturnType<typeof quickNoteService.dismissProposal>>);

        await useQuickNoteStore.getState().dismissProposal('a', 'p1', reason);

        expect(dismiss).toHaveBeenCalledWith('p1', reason);
        expect(refreshAgenticDetails).toHaveBeenCalledWith('a');
      },
    );

    /** @example An edit overwrites the payload the user saw. */
    it('updates a proposal payload', async () => {
      const update = vi
        .spyOn(quickNoteService, 'updateProposal')
        .mockResolvedValue({} as Awaited<ReturnType<typeof quickNoteService.updateProposal>>);
      const payload = { instruction: 'New', name: 'Task' };

      await useQuickNoteStore.getState().updateProposal('a', 'p1', payload);

      expect(update).toHaveBeenCalledWith('p1', payload);
      expect(refreshAgenticDetails).toHaveBeenCalledWith('a');
    });
  });

  // ROOT CAUSE:
  // The server marks Proposals stale only after its debounced meaning check (minute sweep + model
  // call), long after the save returned, and nothing re-read them, so 「原文已修改」 appeared only
  // after a reload or refocus.
  /** @example A real edit re-reads current Proposals around the server's meaning check. */
  describe('stale check refresh', () => {
    const CHECK_DELAY = 6000;
    const proposal = (validity: QuickNoteProposal['validity']): QuickNoteProposal => ({
      createdAt: 1000,
      decisionStatus: 'pending',
      id: 'p1',
      kind: 'task',
      originalPayload: {},
      payload: {},
      updatedAt: 1000,
      validity,
    });
    const refreshAgenticDetails = vi.fn();
    const withProposal = (validity: QuickNoteProposal['validity']) => ({
      agenticDetailMap: { a: { comments: [], proposals: [proposal(validity)], resources: [] } },
    });

    beforeEach(() => {
      vi.mocked(quickNoteService.updateNoteContent).mockImplementation(async () => ({
        contentChange: 'changed',
        contentCheckDueAt: Date.now() + CHECK_DELAY,
      }));
      refreshAgenticDetails.mockReset().mockResolvedValue(undefined);
      resetStore({
        notes: [createNoteItem({ id: 'a' })],
        notesInit: true,
        ...withProposal('current'),
      });
      useQuickNoteStore.setState({ refreshAgenticDetails });
    });

    const edit = async (content = 'a different idea') => {
      useQuickNoteStore.getState().updateNoteContent('a', content);
      await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE);
    };

    it('refreshes after the check is due and stops once the Proposal turns stale', async () => {
      await edit();
      await vi.advanceTimersByTimeAsync(CHECK_DELAY + STALE_CHECK_REFRESH_DELAYS[0] - 1);
      /** @example Nothing is read before the check can have run. */
      expect(refreshAgenticDetails).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(refreshAgenticDetails).toHaveBeenCalledWith('a');

      refreshAgenticDetails.mockImplementation(async () => {
        useQuickNoteStore.setState(withProposal('stale'));
      });
      await vi.advanceTimersByTimeAsync(STALE_CHECK_REFRESH_DELAYS[1]);
      expect(refreshAgenticDetails).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      /** @example The series stops as soon as the badge can show. */
      expect(refreshAgenticDetails).toHaveBeenCalledTimes(2);
    });

    it('gives up after a bounded number of retries', async () => {
      await edit();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(refreshAgenticDetails).toHaveBeenCalledTimes(STALE_CHECK_REFRESH_DELAYS.length);
    });

    it('does not refresh without current Proposals or for a cosmetic edit', async () => {
      resetStore({
        notes: [createNoteItem({ id: 'a' })],
        notesInit: true,
        ...withProposal('stale'),
      });
      useQuickNoteStore.setState({ refreshAgenticDetails });
      await edit();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(refreshAgenticDetails).not.toHaveBeenCalled();

      resetStore({
        notes: [createNoteItem({ id: 'a' })],
        notesInit: true,
        ...withProposal('current'),
      });
      useQuickNoteStore.setState({ refreshAgenticDetails });
      vi.mocked(quickNoteService.updateNoteContent).mockResolvedValue({
        contentChange: 'equivalent',
      });
      await edit();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(refreshAgenticDetails).not.toHaveBeenCalled();
    });

    it('stops when the surface goes inactive or another note opens', async () => {
      await edit();
      useQuickNoteStore.getState().setPollingActive(false);
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(refreshAgenticDetails).not.toHaveBeenCalled();

      useQuickNoteStore.getState().setPollingActive(true);
      await edit('another idea');
      useQuickNoteStore.setState({ activeNoteId: 'b' });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(refreshAgenticDetails).not.toHaveBeenCalled();

      /** @example The same edit on the open note does refresh. */
      useQuickNoteStore.setState({ activeNoteId: 'a' });
      await edit('a third idea');
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(refreshAgenticDetails).toHaveBeenCalled();
    });
  });

  it('toggleAiPanel flips and accepts an explicit target', () => {
    expect(useQuickNoteStore.getState().aiPanelExpanded).toBe(true);

    useQuickNoteStore.getState().toggleAiPanel();
    expect(useQuickNoteStore.getState().aiPanelExpanded).toBe(false);

    useQuickNoteStore.getState().toggleAiPanel(true);
    expect(useQuickNoteStore.getState().aiPanelExpanded).toBe(true);
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
