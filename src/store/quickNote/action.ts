import { debounce } from 'es-toolkit/compat';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { quickNoteService } from '@/services/quickNote';
import type { StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';

import { initialState } from './initialState';
import type { QuickNoteStore } from './store';

/** Quiet period after a persisted edit before the client asks the server to claim Analyze. */
export const ANALYZE_SETTLE_DELAY = 6000;
/** Poll interval used to recover terminal Dive state through the existing service boundary. */
export const DIVE_POLL_INTERVAL = 1000;
/** Poll interval used to project completed background Analyze into the open panel. */
export const ANALYZE_POLL_INTERVAL = 1000;
/**
 * Bounded follow-up reads after a Dive first appears terminal without its Annotation projection.
 *
 * The Agent Operation and its completion hook are delivered independently, so one status read can
 * observe the terminal operation before the Annotation transaction becomes visible.
 */
export const DIVE_TERMINAL_RECONCILE_ATTEMPTS = 3;
/** Editor save debounce that limits network writes while typing. */
export const PERSIST_DEBOUNCE = 1000;
/** Maximum time an active editor may defer its next durable save. */
export const PERSIST_MAX_WAIT = 5000;

type Setter = StoreSetter<QuickNoteStore>;

const agenticDetailKey = (id: string) => ['QUICK_NOTE_AGENTIC_DETAIL', id] as const;

/**
 * Coordinates optimistic Quick Note editing with server-owned persistence and Runs.
 *
 * Use when:
 * - Existing Quick Note components need CRUD, save status, Analyze, and Dive actions.
 *
 * Expects:
 * - The service owns durable state; local records are optimistic projections only.
 *
 * Returns:
 * - Public actions flattened into the Quick Note Zustand store.
 */
export class QuickNoteActionImpl {
  readonly #get: () => QuickNoteStore;
  readonly #set: (state: Partial<QuickNoteStore>, replace?: false, action?: string) => void;
  readonly #rawSet: Setter;
  #disposed = false;
  #pollingActive = true;
  readonly #observedAnalyze = new Set<string>();
  readonly #observedDive = new Set<string>();
  readonly #pollFailures = new Map<string, number>();
  readonly #dirtyIds = new Set<string>();
  readonly #pendingEditorData = new Map<string, Record<string, unknown>>();
  readonly #analyzeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #analyzePollers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #divePollers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #diveBaselineAnnotationTimes = new Map<string, number | undefined>();
  readonly #diveTerminalReconcileAttempts = new Map<string, number>();

  constructor(set: Setter, get: () => QuickNoteStore, _api?: unknown) {
    void _api;
    this.#rawSet = set;
    this.#set = (state, replace, action) => {
      if (!this.#disposed) set(state, replace, action);
    };
    this.#get = get;
  }

  /**
   * Clears scoped data and replaces actions so old asynchronous work cannot write into the new scope.
   *
   * Use when:
   * - The authenticated user, server, or active workspace changes.
   *
   * Expects:
   * - Scope switching calls reset before hydrating the next list.
   *
   * Returns:
   * - A clean store; old timers, pending saves, and response writers are invalidated.
   */
  reset = (): void => {
    this.#disposed = true;
    this.#persist.cancel();
    for (const timers of [this.#analyzeTimers, this.#analyzePollers, this.#divePollers]) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
    this.#dirtyIds.clear();
    this.#pendingEditorData.clear();
    this.#rawSet(
      {
        ...initialState,
        ...flattenActions<QuickNoteAction>([new QuickNoteActionImpl(this.#rawSet, this.#get)]),
      },
      false,
      'resetQuickNoteStore',
    );
  };

  /**
   * Suspends status reads while the Quick Note surface is inactive and resumes pending observations.
   *
   * Use when:
   * - The note surface mounts, unmounts, or changes document visibility.
   *
   * Expects:
   * - Persistence and server-side execution continue independently.
   *
   * Returns:
   * - Nothing; suspended run observations are retained until resumption or reset.
   */
  setPollingActive = (active: boolean): void => {
    if (this.#disposed) return;
    this.#pollingActive = active;
    for (const timers of [this.#analyzePollers, this.#divePollers]) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
    if (!active) return;
    for (const id of this.#observedAnalyze) this.#scheduleAnalyzePoll(id);
    for (const id of this.#observedDive) this.#scheduleDivePoll(id);
  };

  initNotes = async () => {
    if (this.#disposed) return;
    if (this.#get().notesInit && !this.#get().notesLoadError) return;
    this.#set({ notesLoadError: false }, false, 'initNotes/start');

    try {
      const notes = await quickNoteService.getNotes();
      const divingNoteIds = notes
        .filter(
          (note) => note.run?.kind === 'dive' && ['pending', 'running'].includes(note.run.status),
        )
        .map((note) => note.id);
      const analyzingActiveNoteIds = notes
        .filter(
          (note) =>
            note.run?.kind === 'analyze' && ['pending', 'running'].includes(note.run.status),
        )
        .map((note) => note.id);
      this.#set(
        {
          divingNoteIds,
          notes,
          notesInit: true,
          notesLoadError: false,
        },
        false,
        'initNotes/success',
      );
      for (const id of divingNoteIds) {
        this.#diveBaselineAnnotationTimes.set(
          id,
          notes.find((note) => note.id === id)?.annotation?.divedAt,
        );
        this.#scheduleDivePoll(id);
      }
      for (const id of analyzingActiveNoteIds) this.#scheduleAnalyzePoll(id);
      for (const note of notes) {
        if (note.analyzeDueAt && !analyzingActiveNoteIds.includes(note.id)) {
          this.#scheduleAnalyze(note.id, note.analyzeDueAt);
        }
      }
    } catch {
      this.#set({ notesInit: true, notesLoadError: true }, false, 'initNotes/failed');
    }
  };

  createNote = async (content = '', editorData?: Record<string, unknown>): Promise<string> => {
    const note = await quickNoteService.createNote(content, editorData);
    this.#set({ notes: [note, ...this.#get().notes] }, false, 'createNote');
    if (note.analyzeDueAt) this.#scheduleAnalyze(note.id, note.analyzeDueAt);
    return note.id;
  };

  flushPendingWrites = async (): Promise<void> => {
    await this.#persist.flush();
  };

  useFetchAgenticDetails = (id?: string) =>
    useClientDataSWR(
      id ? agenticDetailKey(id) : null,
      () => quickNoteService.getAgenticDetails(id!),
      {
        onSuccess: (details) => {
          this.#set(
            { agenticDetailMap: { ...this.#get().agenticDetailMap, [id!]: details } },
            false,
            'useFetchAgenticDetails/success',
          );
        },
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
      },
    );

  refreshAgenticDetails = async (id: string): Promise<void> => {
    if (!this.#disposed) await mutate(agenticDetailKey(id));
  };

  createComment = async (quickNoteId: string, content: string): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed || this.#get().creatingCommentNoteIds.includes(quickNoteId)) return;

    this.#set(
      { creatingCommentNoteIds: [...this.#get().creatingCommentNoteIds, quickNoteId] },
      false,
      'createComment/start',
    );
    try {
      await quickNoteService.createComment(quickNoteId, trimmed);
      await this.refreshAgenticDetails(quickNoteId);
    } finally {
      this.#set(
        {
          creatingCommentNoteIds: this.#get().creatingCommentNoteIds.filter(
            (id) => id !== quickNoteId,
          ),
        },
        false,
        'createComment/end',
      );
    }
  };

  updateComment = async (
    quickNoteId: string,
    commentId: string,
    content: string,
  ): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed || this.#get().editingCommentIds.includes(commentId)) return;

    this.#set(
      { editingCommentIds: [...this.#get().editingCommentIds, commentId] },
      false,
      'updateComment/start',
    );
    try {
      await quickNoteService.updateComment(commentId, trimmed);
      await this.refreshAgenticDetails(quickNoteId);
    } finally {
      this.#set(
        { editingCommentIds: this.#get().editingCommentIds.filter((id) => id !== commentId) },
        false,
        'updateComment/end',
      );
    }
  };

  updateProposal = async (
    quickNoteId: string,
    proposalId: string,
    content: string,
  ): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed || this.#get().processingProposalIds.includes(proposalId)) return;

    this.#set(
      { processingProposalIds: [...this.#get().processingProposalIds, proposalId] },
      false,
      'updateProposal/start',
    );
    try {
      await quickNoteService.updateProposal(proposalId, trimmed);
      await this.refreshAgenticDetails(quickNoteId);
    } finally {
      this.#set(
        {
          processingProposalIds: this.#get().processingProposalIds.filter(
            (id) => id !== proposalId,
          ),
        },
        false,
        'updateProposal/end',
      );
    }
  };

  acceptProposal = async (quickNoteId: string, proposalId: string) => {
    if (this.#get().processingProposalIds.includes(proposalId)) return undefined;
    this.#set(
      { processingProposalIds: [...this.#get().processingProposalIds, proposalId] },
      false,
      'acceptProposal/start',
    );
    try {
      const result = await quickNoteService.acceptProposal(proposalId);
      await this.refreshAgenticDetails(quickNoteId);
      return result;
    } finally {
      this.#set(
        {
          processingProposalIds: this.#get().processingProposalIds.filter(
            (id) => id !== proposalId,
          ),
        },
        false,
        'acceptProposal/end',
      );
    }
  };

  dismissProposal = async (quickNoteId: string, proposalId: string): Promise<void> => {
    if (this.#get().processingProposalIds.includes(proposalId)) return;
    this.#set(
      { processingProposalIds: [...this.#get().processingProposalIds, proposalId] },
      false,
      'dismissProposal/start',
    );
    try {
      await quickNoteService.dismissProposal(proposalId);
      await this.refreshAgenticDetails(quickNoteId);
    } finally {
      this.#set(
        {
          processingProposalIds: this.#get().processingProposalIds.filter(
            (id) => id !== proposalId,
          ),
        },
        false,
        'dismissProposal/end',
      );
    }
  };

  removeNote = async (id: string) => {
    await quickNoteService.removeNote(id);
    const analyzeTimer = this.#analyzeTimers.get(id);
    if (analyzeTimer) clearTimeout(analyzeTimer);
    const analyzePoller = this.#analyzePollers.get(id);
    if (analyzePoller) clearTimeout(analyzePoller);
    const divePoller = this.#divePollers.get(id);
    if (divePoller) clearTimeout(divePoller);
    this.#analyzeTimers.delete(id);
    this.#analyzePollers.delete(id);
    this.#divePollers.delete(id);
    this.#observedAnalyze.delete(id);
    this.#observedDive.delete(id);
    this.#pollFailures.delete('analyze:' + id);
    this.#pollFailures.delete('dive:' + id);
    this.#diveBaselineAnnotationTimes.delete(id);
    this.#diveTerminalReconcileAttempts.delete(id);
    this.#dirtyIds.delete(id);
    this.#pendingEditorData.delete(id);
    const { activeNoteId, agenticDetailMap, notes } = this.#get();
    const { [id]: _, ...remainingAgenticDetails } = agenticDetailMap;
    this.#set(
      {
        activeNoteId: activeNoteId === id ? undefined : activeNoteId,
        agenticDetailMap: remainingAgenticDetails,
        notes: notes.filter((note) => note.id !== id),
      },
      false,
      'removeNote',
    );
  };

  updateNoteContent = (
    id: string,
    content: string,
    editorData: Record<string, unknown> = { markdown: content },
  ) => {
    const target = this.#get().notes.find((note) => note.id === id);
    if (!target || (target.content === content && target.editorData === editorData)) return;

    const scheduledAnalyze = this.#analyzeTimers.get(id);
    if (scheduledAnalyze) clearTimeout(scheduledAnalyze);
    this.#analyzeTimers.delete(id);

    this.#pendingEditorData.set(id, editorData);
    this.#dirtyIds.add(id);
    this.#set(
      {
        notes: this.#get().notes.map((note) =>
          note.id === id
            ? { ...note, content, analyzeDueAt: undefined, editorData, updatedAt: Date.now() }
            : note,
        ),
        saveStatus: 'saving',
      },
      false,
      'updateNoteContent',
    );
    this.#persist();
  };

  analyzeNote = async (id: string): Promise<void> => {
    const { analyzingNoteIds, notes } = this.#get();
    const note = notes.find((item) => item.id === id);
    if (
      !note?.content.trim() ||
      analyzingNoteIds.includes(id) ||
      (note.run && ['pending', 'running'].includes(note.run.status))
    ) {
      return;
    }

    const priorTimer = this.#analyzeTimers.get(id);
    if (priorTimer) clearTimeout(priorTimer);
    this.#analyzeTimers.delete(id);

    // Manual Analyze must pin the editor revision visible when the user clicks the action.
    await this.#persist.flush();
    if (this.#disposed || this.#get().saveStatus === 'failed') return;

    // Flushing persistence can schedule a fresh automatic timer for this same revision.
    const scheduledAnalyze = this.#analyzeTimers.get(id);
    if (scheduledAnalyze) clearTimeout(scheduledAnalyze);
    this.#analyzeTimers.delete(id);

    this.#set(
      { analyzingNoteIds: [...this.#get().analyzingNoteIds, id] },
      false,
      'analyzeNote/start',
    );
    try {
      const trigger =
        note.run?.kind === 'analyze' && note.run.status === 'failed' ? 'retry' : 'manual';
      const result = await quickNoteService.analyze(id, trigger);
      if (!result.accepted) return;

      this.#set(
        {
          notes: this.#get().notes.map((item) =>
            item.id === id
              ? {
                  ...item,
                  analyzeDueAt: undefined,
                  run: {
                    kind: result.run.kind,
                    operationId: result.run.operationId,
                    status: result.run.status,
                    threadId: result.run.threadId,
                    trigger,
                  },
                }
              : item,
          ),
        },
        false,
        'analyzeNote/accepted',
      );
      this.#scheduleAnalyzePoll(id);
    } finally {
      this.#set(
        { analyzingNoteIds: this.#get().analyzingNoteIds.filter((item) => item !== id) },
        false,
        'analyzeNote/end',
      );
    }
  };

  diveInto = async (id: string) => {
    const { divingNoteIds, notes } = this.#get();
    if (divingNoteIds.includes(id)) return;

    const note = notes.find((item) => item.id === id);
    if (!note || !note.content.trim()) return;

    // Dive must pin the latest durable revision, including edits still inside the save debounce.
    await this.#persist.flush();
    if (this.#disposed || this.#get().saveStatus === 'failed') return;

    this.#set({ divingNoteIds: [...divingNoteIds, id] }, false, 'diveInto/start');
    this.#diveBaselineAnnotationTimes.set(
      id,
      this.#get().notes.find((item) => item.id === id)?.annotation?.divedAt,
    );
    this.#diveTerminalReconcileAttempts.delete(id);

    try {
      await quickNoteService.dive(id);
      this.#scheduleDivePoll(id);
    } catch (error) {
      this.#set(
        { divingNoteIds: this.#get().divingNoteIds.filter((item) => item !== id) },
        false,
        'diveInto/failed',
      );
      this.#diveBaselineAnnotationTimes.delete(id);
      throw error;
    }
  };

  setActiveCollection = (collection: string | null) => {
    this.#set({ activeCollection: collection, activeTag: null }, false, 'setActiveCollection');
  };

  setActiveTag = (tag: string | null) => {
    this.#set({ activeCollection: null, activeTag: tag }, false, 'setActiveTag');
  };

  setSearchKeywords = (searchKeywords: string) => {
    this.#set({ searchKeywords }, false, 'setSearchKeywords');
  };

  toggleAnnotationPanel = (expand?: boolean) => {
    this.#set(
      { annotationPanelExpanded: expand ?? !this.#get().annotationPanelExpanded },
      false,
      'toggleAnnotationPanel',
    );
  };

  retrySave = () => {
    this.#set({ saveStatus: 'saving' }, false, 'retrySave');
    // Failed saves retain their payloads; hydrated but untouched notes must not be rewritten.
    for (const id of this.#pendingEditorData.keys()) this.#dirtyIds.add(id);
    this.#persist();
    this.#persist.flush();
  };

  #persist = debounce(
    async () => {
      if (this.#disposed) return;
      const ids = [...this.#dirtyIds];
      if (ids.length === 0) return;
      for (const id of ids) this.#dirtyIds.delete(id);

      try {
        await Promise.all(
          ids.map(async (id) => {
            const note = this.#get().notes.find((item) => item.id === id);
            const editorData = this.#pendingEditorData.get(id);
            if (!note || !editorData) return;
            const result = await quickNoteService.updateNoteContent(id, note.content, editorData);
            // A newer editor change may arrive while this network write is in flight.
            // Only clear the exact payload that this invocation durably saved.
            if (this.#pendingEditorData.get(id) === editorData) {
              this.#pendingEditorData.delete(id);
              this.#set(
                {
                  notes: this.#get().notes.map((item) =>
                    item.id === id ? { ...item, analyzeDueAt: result.analyzeDueAt } : item,
                  ),
                },
                false,
                'persist/analyzeDueAt',
              );
              if (result.analyzeDueAt) this.#scheduleAnalyze(id, result.analyzeDueAt);
            }
          }),
        );
        if (this.#dirtyIds.size === 0) this.#set({ saveStatus: 'saved' }, false, 'persist');
      } catch {
        for (const id of ids) this.#dirtyIds.add(id);
        this.#set({ saveStatus: 'failed' }, false, 'persist/failed');
      }
    },
    PERSIST_DEBOUNCE,
    { maxWait: PERSIST_MAX_WAIT },
  );

  #scheduleAnalyze = (id: string, dueAt: number) => {
    if (this.#disposed) return;
    const existing = this.#analyzeTimers.get(id);
    if (existing) clearTimeout(existing);

    this.#analyzeTimers.set(
      id,
      setTimeout(
        async () => {
          this.#analyzeTimers.delete(id);
          // The server-side due-time sweep is the durable fallback when this best-effort
          // request loses connectivity or the page closes before the quiet period ends.
          try {
            const result = await quickNoteService.analyze(id, 'automatic');
            if (result.accepted) this.#scheduleAnalyzePoll(id);
          } catch {
            // The persisted due time remains claimable by the server sweep.
          }
        },
        Math.max(0, dueAt - Date.now()),
      ),
    );
  };

  /** Fetches run metadata while preserving edits pending or made during the request. */
  #getPolledNotes = async () => {
    const before = new Map(this.#get().notes.map((note) => [note.id, note]));
    const pending = new Set(this.#pendingEditorData.keys());
    const notes = await quickNoteService.getNotes();
    const current = new Map(this.#get().notes.map((note) => [note.id, note]));
    return notes.map((note) => {
      const local = current.get(note.id);
      const original = before.get(note.id);
      if (
        !local ||
        (!pending.has(note.id) &&
          !this.#pendingEditorData.has(note.id) &&
          local.content === original?.content &&
          local.editorData === original?.editorData)
      )
        return note;
      return {
        ...note,
        content: local.content,
        editorData: local.editorData,
        updatedAt: local.updatedAt,
      };
    });
  };

  #scheduleAnalyzePoll = (id: string) => {
    if (this.#disposed) return;
    this.#observedAnalyze.add(id);
    if (!this.#pollingActive) return;
    const existing = this.#analyzePollers.get(id);
    if (existing) clearTimeout(existing);

    this.#analyzePollers.set(
      id,
      setTimeout(
        async () => {
          this.#analyzePollers.delete(id);
          try {
            const notes = await this.#getPolledNotes();
            const note = notes.find((item) => item.id === id);
            this.#pollFailures.delete('analyze:' + id);
            // The list exposes one active run; another kind can hide this run until it finishes.
            const active = Boolean(note?.run && ['pending', 'running'].includes(note.run.status));

            this.#set({ notes }, false, active ? 'analyze/poll' : 'analyze/done');
            if (active) {
              this.#scheduleAnalyzePoll(id);
            } else {
              this.#observedAnalyze.delete(id);
              await this.refreshAgenticDetails(id);
            }
          } catch {
            // Keep recovering background Analyze after a transient status request failure.
            // Exponential delay caps outage traffic at one retry per 30 seconds for this observation.
            this.#pollFailures.set(
              'analyze:' + id,
              (this.#pollFailures.get('analyze:' + id) ?? 0) + 1,
            );
            this.#scheduleAnalyzePoll(id);
          }
        },
        Math.min(
          30_000,
          ANALYZE_POLL_INTERVAL * 2 ** Math.min(this.#pollFailures.get('analyze:' + id) ?? 0, 5),
        ),
      ),
    );
  };

  #scheduleDivePoll = (id: string) => {
    if (this.#disposed) return;
    this.#observedDive.add(id);
    if (!this.#pollingActive) return;
    const existing = this.#divePollers.get(id);
    if (existing) clearTimeout(existing);

    this.#divePollers.set(
      id,
      setTimeout(
        async () => {
          this.#divePollers.delete(id);
          try {
            const notes = await this.#getPolledNotes();
            const note = notes.find((item) => item.id === id);
            this.#pollFailures.delete('dive:' + id);
            // The list exposes one active run; another kind can hide this run until it finishes.
            const active = Boolean(note?.run && ['pending', 'running'].includes(note.run.status));
            const baselineAnnotationTime = this.#diveBaselineAnnotationTimes.get(id);
            const reconcileAttempts = this.#diveTerminalReconcileAttempts.get(id) ?? 0;
            const projectionPending =
              Boolean(note) &&
              !active &&
              note?.annotation?.divedAt === baselineAnnotationTime &&
              reconcileAttempts < DIVE_TERMINAL_RECONCILE_ATTEMPTS;

            if (projectionPending) {
              this.#diveTerminalReconcileAttempts.set(id, reconcileAttempts + 1);
            } else if (!active) {
              this.#diveBaselineAnnotationTimes.delete(id);
              this.#diveTerminalReconcileAttempts.delete(id);
            }

            this.#set(
              {
                divingNoteIds:
                  active || projectionPending
                    ? this.#get().divingNoteIds
                    : this.#get().divingNoteIds.filter((item) => item !== id),
                notes,
              },
              false,
              active || projectionPending ? 'diveInto/poll' : 'diveInto/done',
            );

            if (active || projectionPending) this.#scheduleDivePoll(id);
            else {
              this.#observedDive.delete(id);
              await this.refreshAgenticDetails(id);
            }
          } catch {
            // Keep recovering the operation after a transient status request failure.
            // Exponential delay caps outage traffic at one retry per 30 seconds for this observation.
            this.#pollFailures.set('dive:' + id, (this.#pollFailures.get('dive:' + id) ?? 0) + 1);
            this.#scheduleDivePoll(id);
          }
        },
        Math.min(
          30_000,
          DIVE_POLL_INTERVAL * 2 ** Math.min(this.#pollFailures.get('dive:' + id) ?? 0, 5),
        ),
      ),
    );
  };
}

export type QuickNoteAction = Pick<QuickNoteActionImpl, keyof QuickNoteActionImpl>;

/** Creates the Quick Note action slice for the shared Zustand store. */
export const createQuickNoteSlice = (set: Setter, get: () => QuickNoteStore, _api?: unknown) =>
  new QuickNoteActionImpl(set, get, _api);
