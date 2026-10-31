import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';

/**
 * How long the session may sit between turns with no stdout before stdin is
 * closed anyway. Background tasks that stream (sub-agents) keep resetting it;
 * a silent one (a long background shell) would otherwise hold the process open
 * forever, since Claude Code's own wind-down ceiling only starts once stdin is
 * closed.
 */
const DEFAULT_IDLE_CLOSE_MS = 30 * 60 * 1000;

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'killed']);

const readIdleCloseMs = (): number => {
  const value = Number(process.env.LOBE_CLAUDE_CODE_LIVE_INPUT_IDLE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_IDLE_CLOSE_MS;
};

/** Stamp a stream-json `user` line with the uuid Claude Code replays it under. */
export const withUserMessageUuid = (stdinLine: string, uuid: string): string =>
  `${JSON.stringify({ ...JSON.parse(stdinLine), uuid })}\n`;

/** How the session's most recent turn ended. */
export interface ClaudeCodeTurnOutcome {
  /** The turn was stopped by an interrupt (`terminal_reason: aborted_*`), not failed. */
  aborted: boolean;
  terminalReason?: string;
}

const isAbortedResult = (message: any): boolean =>
  !!message.is_error && String(message.terminal_reason ?? '').startsWith('aborted');

export interface ClaudeCodeLiveInputOptions {
  idleCloseMs?: number;
}

/**
 * Keeps a Claude Code print-mode (`-p --input-format stream-json`) stdin open
 * for as long as the run can still use input, so the host can deliver a user
 * message into the running session or interrupt only the current turn.
 *
 * Closing stdin early is not neutral: once input is closed, print mode stops
 * waiting for background tasks after `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`
 * (10 minutes by default) and kills them. So stdin stays open until the session
 * is between turns with no running task and no delivered message it has not
 * picked up yet. A notification for a task that finished during the last turn
 * is still delivered after the close, because print mode drains those itself.
 *
 * Requires `--replay-user-messages`: the replayed `uuid` is how a delivered
 * message is known to have been picked up.
 */
export class ClaudeCodeLiveInput {
  private readonly activeTasks = new Set<string>();
  private closed = false;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly idleCloseMs: number;
  private lastOutcome: ClaudeCodeTurnOutcome | undefined;
  private lineBuffer = '';
  private turnOpen = true;
  private readonly unconsumed = new Set<string>();

  constructor(
    private readonly stdin: Writable,
    options: ClaudeCodeLiveInputOptions = {},
  ) {
    this.idleCloseMs = options.idleCloseMs ?? readIdleCloseMs();
    stdin.on('error', () => this.markClosed());
    stdin.on('close', () => this.markClosed());
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** How the last turn ended; undefined while the session has not finished one. */
  get lastTurn(): ClaudeCodeTurnOutcome | undefined {
    return this.lastOutcome;
  }

  /**
   * Deliver a `user` line into the session; it stays pending until Claude Code
   * replays it. Returns false once input has closed.
   */
  send(stdinLine: string, uuid: string = randomUUID()): boolean {
    if (this.closed) return false;

    this.unconsumed.add(uuid);
    this.clearIdleTimer();
    this.stdin.write(withUserMessageUuid(stdinLine, uuid));
    return true;
  }

  /** Stop the current turn without ending the process. Returns false once input has closed. */
  interrupt(): boolean {
    if (this.closed) return false;

    this.stdin.write(
      `${JSON.stringify({
        request: { subtype: 'interrupt' },
        request_id: randomUUID(),
        type: 'control_request',
      })}\n`,
    );
    return true;
  }

  /** Feed raw stdout so the session state tracks what Claude Code reports. */
  observe(chunk: Buffer | string): void {
    this.lineBuffer += chunk.toString();
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message?.type === 'result') {
          this.lastOutcome = {
            aborted: isAbortedResult(message),
            terminalReason: message.terminal_reason,
          };
        }
        // Turns still run after input closes, so keep tracking them.
        this.observeMessage(message);
      } catch {
        // Non-JSON noise on stdout carries no session state.
      }
    }

    // The idle clock only runs between turns; any output then, a sub-agent's
    // included, restarts it.
    if (this.closed) return;
    if (this.turnOpen) this.clearIdleTimer();
    else this.armIdleTimer();
  }

  /**
   * stdout ended: take a final record left without a trailing newline, then
   * close input, since nothing can read it any more.
   */
  finish(): void {
    if (this.lineBuffer.trim()) this.observe('\n');
    this.close();
  }

  close(): void {
    if (this.closed) return;

    this.markClosed();
    this.stdin.end();
  }

  private observeMessage(message: any): void {
    // A background sub-agent's turn records are activity of its task, not a
    // main turn: they must not hold the session open once the task ends. Its
    // task lifecycle (`system`) still counts.
    if (message?.parent_tool_use_id && message.type !== 'system') return;

    switch (message?.type) {
      case 'user': {
        if (message.isReplay && typeof message.uuid === 'string') {
          this.unconsumed.delete(message.uuid);
          this.openTurn();
        }
        return;
      }
      case 'assistant':
      case 'stream_event': {
        this.openTurn();
        return;
      }
      case 'system': {
        this.observeSystem(message);
        return;
      }
      case 'result': {
        this.turnOpen = false;
        // A failed turn ends the run for the host, so nothing would read later
        // input. An interrupt the host sent reports `aborted_*` and is not one.
        if (message.is_error && !isAbortedResult(message)) this.close();
        else this.closeIfIdle();
        return;
      }
    }
  }

  private observeSystem(message: any): void {
    if (message.subtype === 'init') {
      this.openTurn();
      return;
    }
    if (message.subtype === 'task_started' && message.task_id) {
      this.activeTasks.add(message.task_id);
      return;
    }

    const ended =
      message.subtype === 'task_notification' ||
      (message.subtype === 'task_updated' &&
        TERMINAL_TASK_STATUSES.has(message.patch?.status as string));
    if (ended && message.task_id) {
      this.activeTasks.delete(message.task_id);
      this.closeIfIdle();
    }
  }

  /** A newer turn supersedes how the last one ended until it reports its own. */
  private openTurn(): void {
    this.turnOpen = true;
    this.lastOutcome = undefined;
  }

  private closeIfIdle(): void {
    if (this.turnOpen || this.activeTasks.size > 0 || this.unconsumed.size > 0) return;
    this.close();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.close(), this.idleCloseMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;

    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private markClosed(): void {
    this.closed = true;
    this.clearIdleTimer();
  }
}
