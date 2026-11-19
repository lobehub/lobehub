import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

/**
 * Silence watchdog for a device-side Claude Code run (`lh hetero exec`).
 *
 * The server cannot stop a stuck device run quickly: a long shell command
 * reaches it as silence, so its own hetero watchdog waits an hour, and the
 * wrapper's operation heartbeat keeps the lease fresh for as long as the
 * wrapper lives. A Claude Code process that hangs (a tool child Windows could
 * not kill, a model call that never answers, a process that never starts a
 * session) would hold its conversation — and a channel's queue — until then.
 *
 * The rule: stop the process once it has been silent for longer than anything
 * it can legitimately be doing allows.
 *
 * | State                                    | Stopped when                                    |
 * | ---------------------------------------- | ----------------------------------------------- |
 * | No output since spawn                    | `startupMs` after spawn                         |
 * | Waiting for the model / the next step    | `silenceMs` after the last output               |
 * | Tool with a timeout (Bash) running       | max(`silenceMs` after the last output,          |
 * |                                          | start + declared timeout + `toolGraceMs`)       |
 * | Tool without a timeout running           | `toolSilenceMs` after the last output           |
 * | Background task running between turns   | `backgroundSilenceMs` after the last output     |
 * | A question / permission prompt is open   | never (waiting on the user)                     |
 *
 * Every limit is measured from the last output, so a run that keeps producing
 * anything — stream deltas, sub-agent turns, retries — is never stopped.
 */

export type SilenceTimeoutKind = 'background' | 'model' | 'startup' | 'tool';

export interface SilenceWatchdogConfig {
  /** Silence allowed while a background task runs between turns. */
  backgroundSilenceMs: number;
  /** Bash timeout Claude Code applies when the call declares none. */
  bashDefaultTimeoutMs: number;
  /** Largest timeout Claude Code accepts for one tool call. */
  maxToolTimeoutMs: number;
  /** Silence allowed while waiting for the model or the next step. */
  silenceMs: number;
  /** Time allowed from spawn to the first output. */
  startupMs: number;
  /** Extra time past a tool's own timeout before it counts as hung. */
  toolGraceMs: number;
  /** Silence allowed while a tool with no timeout of its own runs. */
  toolSilenceMs: number;
}

const MINUTE = 60_000;

export const DEFAULT_SILENCE_WATCHDOG_CONFIG: SilenceWatchdogConfig = {
  // Claude Code's live input closes stdin after 30 min idle between turns, and
  // print mode then waits up to 10 min for background tasks before killing them.
  backgroundSilenceMs: 45 * MINUTE,
  bashDefaultTimeoutMs: 2 * MINUTE,
  maxToolTimeoutMs: 10 * MINUTE,
  // Longer than Claude Code's own 10 min API request timeout, so a healthy
  // process always reports its retry before this fires.
  silenceMs: 15 * MINUTE,
  startupMs: 3 * MINUTE,
  toolGraceMs: 2 * MINUTE,
  toolSilenceMs: 30 * MINUTE,
};

/** Env names (minutes) that override {@link DEFAULT_SILENCE_WATCHDOG_CONFIG}. */
export const SILENCE_WATCHDOG_ENV = {
  backgroundSilenceMs: 'LOBE_HETERO_WATCHDOG_BACKGROUND_SILENCE_MINUTES',
  disabled: 'LOBE_HETERO_WATCHDOG_DISABLED',
  silenceMs: 'LOBE_HETERO_WATCHDOG_SILENCE_MINUTES',
  startupMs: 'LOBE_HETERO_WATCHDOG_STARTUP_MINUTES',
  toolGraceMs: 'LOBE_HETERO_WATCHDOG_TOOL_GRACE_MINUTES',
  toolSilenceMs: 'LOBE_HETERO_WATCHDOG_TOOL_SILENCE_MINUTES',
} as const;

const readPositiveNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Resolve the watchdog configuration from the environment.
 *
 * Returns `undefined` when the watchdog is disabled. Claude Code's own
 * `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS` raise the tool budgets, so
 * a user who allows longer shell commands is not stopped at the stock limits.
 */
export const resolveSilenceWatchdogConfig = (
  env: NodeJS.ProcessEnv = process.env,
): SilenceWatchdogConfig | undefined => {
  const disabled = env[SILENCE_WATCHDOG_ENV.disabled];
  if (disabled === '1' || disabled === 'true') return;

  const minutes = (key: keyof typeof SILENCE_WATCHDOG_ENV, fallback: number) => {
    const value = readPositiveNumber(env[SILENCE_WATCHDOG_ENV[key]]);
    return value === undefined ? fallback : value * MINUTE;
  };
  const defaults = DEFAULT_SILENCE_WATCHDOG_CONFIG;
  const bashDefaultTimeoutMs =
    readPositiveNumber(env.BASH_DEFAULT_TIMEOUT_MS) ?? defaults.bashDefaultTimeoutMs;
  const maxToolTimeoutMs = Math.max(
    defaults.maxToolTimeoutMs,
    readPositiveNumber(env.BASH_MAX_TIMEOUT_MS) ?? 0,
    bashDefaultTimeoutMs,
  );

  return {
    backgroundSilenceMs: minutes('backgroundSilenceMs', defaults.backgroundSilenceMs),
    bashDefaultTimeoutMs,
    maxToolTimeoutMs,
    silenceMs: minutes('silenceMs', defaults.silenceMs),
    startupMs: minutes('startupMs', defaults.startupMs),
    toolGraceMs: minutes('toolGraceMs', defaults.toolGraceMs),
    toolSilenceMs: minutes('toolSilenceMs', defaults.toolSilenceMs),
  };
};

export interface SilenceTimeout {
  kind: SilenceTimeoutKind;
  message: string;
  /** How long the process had been silent when it was stopped. */
  silentMs: number;
  /** Name of the tool that was running, for `kind: 'tool'`. */
  toolName?: string;
}

interface PendingTool {
  name: string;
  startedAt: number;
  /** The tool's own timeout, when it has one. */
  timeoutMs?: number;
}

export const formatWatchdogDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
};

const parseToolInput = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * Pure state machine behind the watchdog: feed it every adapted event and
 * every raw output chunk, then ask {@link check} whether the process is hung.
 * It never reads a clock itself, so it can be tested with plain numbers.
 */
export class HeteroSilenceWatchdog {
  private readonly backgroundTasks = new Set<string>();
  private lastActivityAt: number | undefined;
  /** What the run was last seen doing, for the error message. */
  private lastActivity = 'starting';
  private readonly pendingTools = new Map<string, PendingTool>();
  private readonly toolNames = new Map<string, string>();

  constructor(
    private readonly config: SilenceWatchdogConfig,
    private readonly spawnedAt: number,
    private readonly agentLabel = 'Claude Code',
  ) {}

  /** Any output from the process (a raw stdout chunk) counts as life. */
  touch(now: number): void {
    this.lastActivityAt = now;
  }

  observe(event: AgentStreamEvent, now: number): void {
    // The wrapper's own heartbeat says nothing about the agent process.
    if (event.type === 'step_complete' && event.data?.phase === 'operation_heartbeat') return;
    this.touch(now);

    switch (event.type) {
      case 'tool_start': {
        const toolCalling = event.data?.toolCalling;
        const id = toolCalling?.id;
        if (typeof id !== 'string') return;
        const name = String(toolCalling.apiName ?? 'tool');
        this.toolNames.set(id, name);
        this.pendingTools.set(id, {
          name,
          startedAt: now,
          timeoutMs: this.declaredTimeout(name, parseToolInput(toolCalling.arguments)),
        });
        this.lastActivity = `started tool \`${name}\``;
        return;
      }
      case 'tool_result':
      case 'tool_end': {
        const id = event.data?.toolCallId;
        if (typeof id !== 'string') return;
        this.pendingTools.delete(id);
        this.lastActivity = `received the result of tool \`${this.toolNames.get(id) ?? 'tool'}\``;
        return;
      }
      case 'background_task': {
        const task = event.data?.task;
        const taskId = task?.taskId;
        if (typeof taskId !== 'string') return;
        if (task.status === 'running') this.backgroundTasks.add(taskId);
        else this.backgroundTasks.delete(taskId);
        return;
      }
      case 'stream_start': {
        this.lastActivity = 'started a model call';
        return;
      }
      case 'stream_chunk': {
        this.lastActivity = 'streamed model output';
        return;
      }
      case 'stream_end': {
        this.lastActivity = 'finished a model response';
        return;
      }
      default: {
        if (event.type === 'agent_runtime_init' || event.type === 'step_start') {
          this.lastActivity = 'started a step';
        }
      }
    }
  }

  /** Returns the timeout to report when the process is hung at `now`. */
  check(now: number): SilenceTimeout | undefined {
    if (this.lastActivityAt === undefined) {
      const silentMs = now - this.spawnedAt;
      if (silentMs < this.config.startupMs) return;
      return {
        kind: 'startup',
        message:
          `${this.agentLabel} produced no output within ${formatWatchdogDuration(silentMs)} ` +
          'of starting (it never started a session), so the device stopped it.',
        silentMs,
      };
    }

    const silentMs = now - this.lastActivityAt;
    const deadline = this.deadline();
    if (now < deadline.at) return;

    const silence = formatWatchdogDuration(silentMs);
    if (deadline.tool) {
      const { name, startedAt, timeoutMs } = deadline.tool;
      const running = formatWatchdogDuration(now - startedAt);
      const detail =
        timeoutMs === undefined
          ? `tool \`${name}\` had been running for ${running}`
          : `tool \`${name}\` had been running for ${running}, past its ` +
            `${formatWatchdogDuration(timeoutMs)} timeout`;
      return {
        kind: 'tool',
        message: `${this.agentLabel} was silent for ${silence} while ${detail}, so the device stopped it.`,
        silentMs,
        toolName: name,
      };
    }
    if (deadline.background) {
      return {
        kind: 'background',
        message:
          `${this.agentLabel} was silent for ${silence} while waiting on a background task, ` +
          'so the device stopped it.',
        silentMs,
      };
    }
    return {
      kind: 'model',
      message:
        `${this.agentLabel} was silent for ${silence} waiting for the model ` +
        `(it last ${this.lastActivity}), so the device stopped it.`,
      silentMs,
    };
  }

  /**
   * The tool's own timeout, when it has one. Claude Code's Bash always has one
   * (default 2 min); any other tool only when its input declares `timeout` (ms).
   */
  private declaredTimeout(name: string, input: Record<string, unknown>): number | undefined {
    const declared = typeof input.timeout === 'number' && input.timeout > 0 ? input.timeout : 0;
    if (name === 'Bash') {
      if (input.run_in_background === true) return;
      return Math.min(declared || this.config.bashDefaultTimeoutMs, this.config.maxToolTimeoutMs);
    }
    return declared ? Math.min(declared, this.config.maxToolTimeoutMs) : undefined;
  }

  private deadline(): { at: number; background?: boolean; tool?: PendingTool } {
    const last = this.lastActivityAt ?? this.spawnedAt;
    let at = last + this.config.silenceMs;
    let tool: PendingTool | undefined;
    let background = false;

    for (const pending of this.pendingTools.values()) {
      const toolAt =
        pending.timeoutMs === undefined
          ? last + this.config.toolSilenceMs
          : Math.max(
              last + this.config.silenceMs,
              pending.startedAt + pending.timeoutMs + this.config.toolGraceMs,
            );
      // Any pending tool names the hang, even one whose budget is not the latest.
      if (!tool || toolAt >= at) tool = pending;
      at = Math.max(at, toolAt);
    }
    if (this.backgroundTasks.size > 0) {
      const backgroundAt = last + this.config.backgroundSilenceMs;
      if (backgroundAt > at) {
        at = backgroundAt;
        background = true;
        tool = undefined;
      }
    }
    return { at, background, tool };
  }
}

export interface SilenceWatchdogRunner {
  observe: (event: AgentStreamEvent) => void;
  stop: () => void;
  touch: () => void;
}

/**
 * Drive a {@link HeteroSilenceWatchdog} on a timer.
 *
 * `isPaused` returning true (a question or permission prompt waiting on the
 * user) counts as activity, so the clock restarts once the user answers.
 * `onTimeout` fires at most once.
 */
export const startSilenceWatchdog = ({
  agentLabel,
  checkIntervalMs = 15_000,
  config,
  isPaused,
  now = Date.now,
  onTimeout,
}: {
  agentLabel?: string;
  checkIntervalMs?: number;
  config: SilenceWatchdogConfig;
  isPaused?: () => boolean;
  now?: () => number;
  onTimeout: (timeout: SilenceTimeout) => void;
}): SilenceWatchdogRunner => {
  const watchdog = new HeteroSilenceWatchdog(config, now(), agentLabel);
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    if (isPaused?.()) {
      watchdog.touch(now());
      return;
    }
    const timeout = watchdog.check(now());
    if (!timeout) return;
    stopped = true;
    clearInterval(timer);
    onTimeout(timeout);
  }, checkIntervalMs);
  timer.unref?.();

  return {
    observe: (event) => {
      if (!stopped) watchdog.observe(event, now());
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    touch: () => {
      if (!stopped) watchdog.touch(now());
    },
  };
};

/**
 * Iterate `source` until it ends or `stop` resolves. Used after the watchdog
 * kills a process: the stream normally ends with it, but a descendant that
 * still holds the pipe must not keep the wrapper from reporting the failure.
 */
export async function* iterateUntil<T>(
  source: AsyncIterable<T>,
  stop: Promise<void>,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const stopped = stop.then(() => ({ stopped: true as const }));
  while (true) {
    const next = await Promise.race([iterator.next(), stopped]);
    if ('stopped' in next) {
      void iterator.return?.()?.catch?.(() => {});
      return;
    }
    if (next.done) return;
    yield next.value;
  }
}
