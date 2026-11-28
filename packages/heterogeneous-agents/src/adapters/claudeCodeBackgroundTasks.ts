import type {
  BackgroundTaskEventData,
  HeteroBackgroundTask,
  HeteroBackgroundTaskStatus,
  HeterogeneousAgentEvent,
} from '../types';
import type { ClaudeCodeTaskSignals } from './claudeCodeTaskSignals';

/** Agent tasks are subagents: the subagent thread list already shows them. */
const AGENT_TASK_TYPES = new Set(['local_agent', 'remote_agent']);
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

const NOTIFICATION_STATUSES: Record<string, HeteroBackgroundTaskStatus> = {
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
};

/** `task_updated` statuses that end a task; CC's `killed` is the `stopped` notification's. */
const TERMINAL_PATCH_STATUSES: Record<string, HeteroBackgroundTaskStatus> = {
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped',
};

/**
 * `run_in_background` Bash answers at once with the path it writes to:
 * "Command running in background with ID: <id>. Output is being written to:
 * <path>.output. …" — the only place the path shows before the task ends.
 */
const OUTPUT_PATH_PATTERN = /Output is being written to: (\S+?\.output)\b/;

interface TrackedTask {
  task: HeteroBackgroundTask;
  toolCallId: string;
  /**
   * CC also tracks a slow FOREGROUND tool as a task (`is_backgrounded: false`).
   * It is not a background task until a patch backgrounds it, so it is only
   * reported from then on.
   */
  visible: boolean;
}

export interface ClaudeCodeTaskEventContext {
  mainToolInput: (toolUseId: string) => Record<string, any> | undefined;
  /** Main-agent tool name for a `tool_use.id`; undefined for subagent inner tools. */
  mainToolName: (toolUseId: string) => string | undefined;
  taskSignals: ClaudeCodeTaskSignals;
}

/**
 * Claude Code background tasks, as complete snapshots for the tool message
 * that started each one.
 *
 * CC reports a task's life as `system` events: `task_started` →
 * `task_updated` / `task_progress` … → `task_notification`. Each one that
 * changes a visible task yields a full {@link BackgroundTaskEventData}, so
 * every consumer simply replaces the stored snapshot.
 *
 * A task ends only when Claude Code says it did: a terminal `task_updated`
 * status (`killed` → `stopped`) or its `task_notification`, never because a
 * stop was requested. CC patches the status the moment the process ends, but
 * may hold the notification until its next turn boundary, so the patch is what
 * keeps a stopped row from reading "running" for half a minute. A task still
 * running when the stream ends is `interrupted`.
 */
export class ClaudeCodeBackgroundTasks {
  private tasks = new Map<string, TrackedTask>();

  /** Every CC `task_*` system event belongs here, reported or not. */
  static isTaskEvent(raw: any): boolean {
    return typeof raw?.subtype === 'string' && raw.subtype.startsWith('task_');
  }

  /**
   * @param enabled Whether snapshots are reported at all; the task lineage of
   *   {@link ClaudeCodeTaskSignals} is driven either way.
   * @param toEvent Wraps one snapshot into the adapter's `background_task` event.
   */
  constructor(
    private readonly enabled: boolean,
    private readonly toEvent: (data: BackgroundTaskEventData) => HeterogeneousAgentEvent,
  ) {}

  /**
   * One CC `task_*` system event. Also drives the callback-turn lineage of
   * {@link ClaudeCodeTaskSignals}, which sees every task, subagents included.
   */
  onSystem(raw: any, ctx: ClaudeCodeTaskEventContext): HeterogeneousAgentEvent[] {
    const taskId: unknown = raw.task_id;
    if (typeof taskId !== 'string' || !taskId) return [];

    switch (raw.subtype) {
      case 'task_started': {
        const toolUseId: unknown = raw.tool_use_id;
        if (typeof toolUseId !== 'string' || !toolUseId) return [];
        const toolName = ctx.mainToolName(toolUseId);
        ctx.taskSignals.start(
          taskId,
          toolUseId,
          toolName ?? 'unknown',
          ctx.mainToolInput(toolUseId),
        );
        return this.start(raw, taskId, toolUseId, toolName);
      }
      case 'task_updated': {
        return this.update(taskId, raw.patch);
      }
      case 'task_progress': {
        return this.progress(taskId, raw);
      }
      case 'task_notification': {
        ctx.taskSignals.end(taskId);
        return this.end(taskId, raw);
      }
      default: {
        return [];
      }
    }
  }

  /**
   * A tool_result: pick up the output path a background Bash answers with.
   * Only main-agent tools start tracked tasks, so a subagent's result never matches.
   */
  onToolResult(toolCallId: string, content: string): HeterogeneousAgentEvent[] {
    const path = OUTPUT_PATH_PATTERN.exec(content)?.[1];
    if (!path) return [];
    for (const tracked of this.tasks.values()) {
      if (tracked.toolCallId !== toolCallId || tracked.task.outputFile) continue;
      tracked.task = { ...tracked.task, outputFile: path };
      return this.snapshot(tracked);
    }
    return [];
  }

  /** The stream ended: every task still running lost its session. */
  flush(now = Date.now()): HeterogeneousAgentEvent[] {
    const out: HeterogeneousAgentEvent[] = [];
    for (const tracked of this.tasks.values()) {
      if (!tracked.visible || tracked.task.status !== 'running') continue;
      tracked.task = { ...tracked.task, endedAt: now, status: 'interrupted' };
      out.push(...this.snapshot(tracked));
    }
    this.tasks.clear();
    return out;
  }

  private start(
    raw: any,
    taskId: string,
    toolCallId: string,
    toolName: string | undefined,
  ): HeterogeneousAgentEvent[] {
    // Subagent inner tools have no main tool message to carry the snapshot.
    if (!toolName || SUBAGENT_TOOL_NAMES.has(toolName)) return [];
    if (AGENT_TASK_TYPES.has(raw.task_type) || raw.subagent_type) return [];

    const tracked: TrackedTask = {
      task: {
        description: typeof raw.description === 'string' ? raw.description : '',
        startedAt: Date.now(),
        status: 'running',
        taskId,
        ...(typeof raw.task_type === 'string' && { taskType: raw.task_type }),
        toolName,
      },
      toolCallId,
      visible: raw.is_backgrounded !== false,
    };
    this.tasks.set(taskId, tracked);
    return this.snapshot(tracked);
  }

  private update(taskId: string, patch: any): HeterogeneousAgentEvent[] {
    const tracked = this.tasks.get(taskId);
    if (!tracked || !patch || typeof patch !== 'object') return [];

    const next = { ...tracked.task };
    if (typeof patch.description === 'string' && patch.description) {
      next.description = patch.description;
    }
    if (typeof patch.error === 'string' && patch.error) next.error = patch.error;
    if (typeof patch.end_time === 'number') next.endedAt = patch.end_time;
    if (patch.is_backgrounded === true) tracked.visible = true;
    const ended = TERMINAL_PATCH_STATUSES[patch.status as string];
    if (ended && next.status === 'running') {
      next.status = ended;
      next.endedAt ??= Date.now();
    }
    tracked.task = next;
    return this.snapshot(tracked);
  }

  private progress(taskId: string, raw: any): HeterogeneousAgentEvent[] {
    const tracked = this.tasks.get(taskId);
    if (!tracked) return [];

    const next = { ...tracked.task };
    if (typeof raw.description === 'string' && raw.description) next.description = raw.description;
    if (typeof raw.summary === 'string' && raw.summary) next.summary = raw.summary;
    if (typeof raw.last_tool_name === 'string') next.lastToolName = raw.last_tool_name;
    tracked.task = next;
    return this.snapshot(tracked);
  }

  private end(taskId: string, raw: any): HeterogeneousAgentEvent[] {
    const tracked = this.tasks.get(taskId);
    // A notification for a task this run never started is a previous run's
    // orphan, reported when a session resumes: its own run already closed it.
    if (!tracked) return [];
    this.tasks.delete(taskId);

    const status = NOTIFICATION_STATUSES[raw.status as string] ?? 'completed';
    tracked.task = {
      ...tracked.task,
      endedAt: tracked.task.endedAt ?? Date.now(),
      status,
      ...(typeof raw.output_file === 'string' &&
        raw.output_file && { outputFile: raw.output_file }),
      ...(typeof raw.summary === 'string' && raw.summary && { summary: raw.summary }),
    };
    return this.snapshot(tracked);
  }

  private snapshot(tracked: TrackedTask): HeterogeneousAgentEvent[] {
    if (!this.enabled || !tracked.visible) return [];
    return [this.toEvent({ task: { ...tracked.task }, toolCallId: tracked.toolCallId })];
  }
}
