import type { ExternalSignalContext } from '../types';

type TaskCompletion = Pick<
  ExternalSignalContext,
  'sourceToolCallId' | 'sourceToolName' | 'taskStatus' | 'taskSummary'
>;

/** How a task ended, as reported by CC's `system/task_notification`. */
export interface TaskEnding {
  /** Raw `task_notification.status`: `completed`, `failed`, `killed`, `stopped`. */
  status?: unknown;
  /** Raw `task_notification.summary`, e.g. `Agent "Review" finished`. */
  summary?: unknown;
}

/** CC reports a user- or agent-cancelled task as `killed` or `stopped`. */
const normalizeTaskStatus = (status: unknown): ExternalSignalContext['taskStatus'] => {
  switch (status) {
    case 'completed':
    case 'failed': {
      return status;
    }
    case 'killed':
    case 'stopped': {
      return 'stopped';
    }
  }
};

interface ActiveTask {
  callbackCount: number;
  shouldSignalCompletion: boolean;
  sourceToolName: string;
  toolUseId: string;
}

/**
 * CC's long-running task lifecycle (Monitor, background Bash, ...) and the
 * external-signal lineage it stamps on turns CC opens WITHOUT fresh user input.
 *
 * `task_started` registers a task that may fire callback turns;
 * `task_notification` (terminal) drops it. While a task is alive, a turn that
 * opens without a preceding `user` event is a signal callback (CC re-invoked
 * the LLM because the task pushed an update); the turn after a task ends is
 * its post-task summary.
 */
export class ClaudeCodeTaskSignals {
  /**
   * Active CC tasks keyed by `task_id`, carrying the originating
   * `tool_use_id`, the resolved tool name, and a counter incremented for each
   * signal callback turn attributed to the task.
   *
   * A task lives from `task_started` until `task_notification`.
   */
  private activeTasks = new Map<string, ActiveTask>();
  /**
   * Source-tool lineage of the most recently completed long-running task,
   * waiting to be stamped on the post-task summary turn with
   * `type: 'task-completion'`.
   *
   * Armed when `task_notification` ends a background task; consumed by the
   * NEXT turn that opens, which carries the tag only when it opened without
   * user input. Cleared on `result` so it never leaks across LLM runs.
   *
   * Lets the renderer keep the summary inside the same AssistantGroup as
   * the preceding callbacks instead of letting it spawn a separate group.
   */
  private pendingTaskCompletion: TaskCompletion | undefined;

  constructor(private readonly signalBackgroundTaskCompletion: boolean) {}

  get hasActiveTasks(): boolean {
    return this.activeTasks.size > 0;
  }

  start(
    taskId: string,
    toolUseId: string,
    sourceToolName: string,
    toolInput: Record<string, any> | undefined,
  ): void {
    this.activeTasks.set(taskId, {
      callbackCount: 0,
      shouldSignalCompletion:
        this.signalBackgroundTaskCompletion && toolInput?.run_in_background === true,
      sourceToolName,
      toolUseId,
    });
  }

  /**
   * A main-agent tool_result landed. If its task is still alive, the task
   * outlived its own call — it runs in the background (`run_in_background`
   * Bash, an `Agent` launched async, which is CC's default), so its
   * `task_notification` wakes the LLM for a summary turn. An inline tool CC
   * merely tracked as a task ends before its result arrives, so it never gets
   * here.
   */
  noteToolResult(toolCallId: string): void {
    if (!this.signalBackgroundTaskCompletion) return;
    for (const task of this.activeTasks.values()) {
      if (task.toolUseId === toolCallId) task.shouldSignalCompletion = true;
    }
  }

  end(taskId: string, ending: TaskEnding = {}): void {
    // Capture lineage BEFORE deleting so the next turn (the post-task summary,
    // after CC re-invokes the LLM with a synthesized task-ended notification)
    // can be tagged with `task-completion`. Last-task-wins if multiple tasks end
    // before a summary fires — in practice CC summarizes once per LLM call.
    //
    // Gate on `callbackCount > 0`: only a task that actually fired out-of-band
    // callback turns while alive is a genuine long-running task whose ending
    // produces a post-task summary (the summary "keeps it inside the same
    // AssistantGroup as the preceding callbacks" — so there must BE preceding
    // callbacks). A task that fires `task_started` and `task_notification`
    // back-to-back with no intervening callback turn was an inline synchronous
    // tool that CC merely tracked as a task (e.g. a slow `git commit` running a
    // lint-staged hook); its `tool_result` is consumed by the next turn in the
    // normal main chain. Tagging that turn `task-completion` mis-anchors it and
    // drops it from the rendered chain — so leave it untagged. A background
    // task (`shouldSignalCompletion`) wakes the LLM even with no callbacks.
    //
    // The status and summary let the notice say which task ended and how
    // (`Agent "Review" finished`), mirroring CC's own notification: a
    // `SendMessage`-resumed subagent has no title in its call arguments, so
    // the summary is the only place that still names it.
    const task = this.activeTasks.get(taskId);
    if (task && (task.callbackCount > 0 || task.shouldSignalCompletion)) {
      const taskStatus = normalizeTaskStatus(ending.status);
      const taskSummary =
        typeof ending.summary === 'string' && ending.summary.trim()
          ? ending.summary.trim()
          : undefined;
      this.pendingTaskCompletion = {
        sourceToolCallId: task.toolUseId,
        sourceToolName: task.sourceToolName,
        ...(taskStatus && { taskStatus }),
        ...(taskSummary && { taskSummary }),
      };
    }
    this.activeTasks.delete(taskId);
  }

  /**
   * Lineage for a newly opened turn. `answersInput` is true when the turn
   * follows a `tool_result` / user message — a natural main-chain turn that
   * carries no signal. CC hands it any task notification that arrived
   * meanwhile, so it also consumes the pending completion.
   */
  openTurn(answersInput: boolean): ExternalSignalContext | undefined {
    if (answersInput) {
      this.pendingTaskCompletion = undefined;
      return undefined;
    }

    if (this.pendingTaskCompletion) {
      // The turn that follows a `task_notification` is that task's post-task
      // summary, even while other tasks are still alive. Tag it with the
      // source-tool lineage so the collector keeps it inside the same
      // AssistantGroup as the preceding callbacks (rendered after the
      // SignalCallbacks block).
      const completion = this.pendingTaskCompletion;
      this.pendingTaskCompletion = undefined;
      return { ...completion, type: 'task-completion' };
    }

    if (this.activeTasks.size > 0) {
      // Pick the most recently registered active task. Multi-task
      // concurrency isn't expected in real Monitor flows but the Map
      // preserves insertion order so this still gives deterministic
      // behavior if it ever happens.
      const task = [...this.activeTasks.values()].at(-1)!;
      task.callbackCount += 1;
      return {
        sequence: task.callbackCount,
        sourceToolCallId: task.toolUseId,
        sourceToolName: task.sourceToolName,
        type: 'tool-stdout',
      };
    }

    return undefined;
  }

  /** Drop unconsumed task-completion lineage so the next LLM run doesn't inherit it. */
  clearPendingCompletion(): void {
    this.pendingTaskCompletion = undefined;
  }
}
