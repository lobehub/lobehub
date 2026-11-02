import type { QuickNoteProposalPayload } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import {
  type QuickNoteDismissReason,
  quickNoteService,
  type QuickNoteTask,
} from '@/services/quickNote';
import type { StoreSetter } from '@/store/types';

import type { QuickNoteStore } from './store';

type Setter = StoreSetter<QuickNoteStore>;

const taskListKey = (id: string) => ['QUICK_NOTE_TASKS', id] as const;

/**
 * Times after a Task was started (apply, auto-apply, Dive) at which the note re-reads its Tasks.
 * The Task is created as `backlog` and moves to `running` once the runner picks it up, after the
 * response; without these reads 「已执行」 kept showing 待办 until a refocus.
 */
export const TASK_STATUS_REFRESH_DELAYS = [2000, 5000];

/**
 * Proposal decisions, Dive, and the Tasks a Quick Note started.
 *
 * Use when:
 * - The note sidebar applies, edits, or dismisses a Proposal, starts a Dive, or lists its Tasks.
 *
 * Expects:
 * - The server owns Proposal state; every write refreshes the note's agentic details afterwards.
 * - `processingProposalIds` is the per-Proposal busy flag, so other cards stay usable.
 *
 * Returns:
 * - Public actions flattened into the Quick Note Zustand store next to the core slice.
 */
export class QuickNoteProposalActionImpl {
  readonly #get: () => QuickNoteStore;
  readonly #set: Setter;
  readonly #taskRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(set: Setter, get: () => QuickNoteStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /** Loads the Tasks a note started; refreshed on focus so finished runs show their status. */
  useFetchTasks = (id?: string) =>
    useClientDataSWR<QuickNoteTask[]>(
      id ? taskListKey(id) : null,
      () => quickNoteService.listTasks(id!),
      {
        onSuccess: (tasks) => {
          this.#set(
            { taskMap: { ...this.#get().taskMap, [id!]: tasks } },
            false,
            'useFetchTasks/success',
          );
        },
        revalidateOnFocus: true,
      },
    );

  refreshTasks = async (id: string): Promise<void> => {
    await mutate(taskListKey(id));
  };

  /**
   * Re-reads a note's Tasks a bounded number of times after one was started, so the sidebar shows
   * it running.
   *
   * Returns:
   * - Nothing. Stops after {@link TASK_STATUS_REFRESH_DELAYS}, or as soon as none of the note's
   *   Tasks is still `backlog`.
   */
  refreshTasksUntilStarted = (id: string, attempt = 0): void => {
    const existing = this.#taskRefreshTimers.get(id);
    if (existing) clearTimeout(existing);
    this.#taskRefreshTimers.delete(id);
    if (attempt >= TASK_STATUS_REFRESH_DELAYS.length) return;

    const delay =
      TASK_STATUS_REFRESH_DELAYS[attempt] - (TASK_STATUS_REFRESH_DELAYS[attempt - 1] ?? 0);
    this.#taskRefreshTimers.set(
      id,
      setTimeout(async () => {
        this.#taskRefreshTimers.delete(id);
        try {
          await this.#get().refreshTasks(id);
        } catch {
          // The next attempt retries.
        }
        const waiting = (this.#get().taskMap[id] ?? []).some((task) => task.status === 'backlog');
        if (waiting) this.refreshTasksUntilStarted(id, attempt + 1);
      }, delay),
    );
  };

  /**
   * Applies a pending Proposal (current or stale) and refreshes the sidebar.
   *
   * Returns:
   * - The server result, or `undefined` when the Proposal is already being processed.
   */
  applyProposal = async (quickNoteId: string, proposalId: string) =>
    this.#whileProcessing(proposalId, 'applyProposal', async () => {
      try {
        const result = await quickNoteService.applyProposal(proposalId);
        await this.#refreshNote(quickNoteId);
        if (result.proposal.resultType === 'task')
          this.#get().refreshTasksUntilStarted(quickNoteId);
        return result;
      } catch (error) {
        // A conflict or missing Proposal means the sidebar is out of date.
        void this.#get().refreshAgenticDetails(quickNoteId);
        throw error;
      }
    });

  /** Dismisses a Proposal with an optional reason code. */
  dismissProposal = async (
    quickNoteId: string,
    proposalId: string,
    reason?: QuickNoteDismissReason,
  ): Promise<void> => {
    await this.#whileProcessing(proposalId, 'dismissProposal', async () => {
      try {
        await quickNoteService.dismissProposal(proposalId, reason);
      } catch (error) {
        // A conflict or missing Proposal means the sidebar is out of date.
        void this.#get().refreshAgenticDetails(quickNoteId);
        throw error;
      }
      await this.#get().refreshAgenticDetails(quickNoteId);
    });
  };

  /** Overwrites a pending Proposal's payload with the user's edit. */
  updateProposal = async (
    quickNoteId: string,
    proposalId: string,
    payload: QuickNoteProposalPayload,
  ): Promise<void> => {
    await this.#whileProcessing(proposalId, 'updateProposal', async () => {
      try {
        await quickNoteService.updateProposal(proposalId, payload);
      } catch (error) {
        // A conflict or missing Proposal means the sidebar is out of date.
        void this.#get().refreshAgenticDetails(quickNoteId);
        throw error;
      }
      await this.#get().refreshAgenticDetails(quickNoteId);
    });
  };

  /**
   * Starts a Dive: the server creates and runs a Task with the note as context.
   *
   * Expects:
   * - Pending editor writes are flushed first so the Task sees the visible revision.
   *
   * Returns:
   * - The new Task id for navigation, or `undefined` when nothing was started.
   */
  diveInto = async (id: string): Promise<string | undefined> => {
    if (this.#get().divingNoteIds.includes(id)) return undefined;

    const note = this.#get().notes.find((item) => item.id === id);
    if (!note?.content.trim()) return undefined;

    this.#set({ divingNoteIds: [...this.#get().divingNoteIds, id] }, false, 'diveInto/start');
    try {
      await this.#get().flushPendingWrites();
      if (this.#get().saveStatus === 'failed') return undefined;

      const { taskId } = await quickNoteService.dive(id);
      void this.#get().refreshTasks(id);
      this.#get().refreshTasksUntilStarted(id);
      return taskId;
    } finally {
      this.#set(
        { divingNoteIds: this.#get().divingNoteIds.filter((item) => item !== id) },
        false,
        'diveInto/end',
      );
    }
  };

  #refreshNote = async (id: string) => {
    await Promise.all([this.#get().refreshAgenticDetails(id), this.#get().refreshTasks(id)]);
  };

  #whileProcessing = async <T>(
    proposalId: string,
    action: string,
    run: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (this.#get().processingProposalIds.includes(proposalId)) return undefined;

    this.#set(
      { processingProposalIds: [...this.#get().processingProposalIds, proposalId] },
      false,
      `${action}/start`,
    );
    try {
      return await run();
    } finally {
      this.#set(
        {
          processingProposalIds: this.#get().processingProposalIds.filter(
            (item) => item !== proposalId,
          ),
        },
        false,
        `${action}/end`,
      );
    }
  };
}

export type QuickNoteProposalAction = Pick<
  QuickNoteProposalActionImpl,
  keyof QuickNoteProposalActionImpl
>;

/** Creates the Proposal, Dive, and Task action slice for the Quick Note store. */
export const createQuickNoteProposalSlice = (
  set: Setter,
  get: () => QuickNoteStore,
  _api?: unknown,
) => new QuickNoteProposalActionImpl(set, get, _api);
