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

/**
 * How long a task that ends between turns may wait for the main-agent turn its
 * notification wakes. Claude Code opens that turn within milliseconds; the
 * grace only bounds an end that unexpectedly wakes nothing. A stopped task
 * never wakes one, so it does not wait (see `observeSystem`).
 */
const DEFAULT_WAKE_UP_GRACE_MS = 30 * 1000;

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

/** How a live session's process ended, as its host saw it. */
export interface ClaudeCodeLiveExit {
  code: number | null;
  /** The host killed the process (cancel, stop, quit): its own path reports that end. */
  killedByHost: boolean;
  /** The run already reported an error event: that error is its end. */
  sawError: boolean;
  signal: NodeJS.Signals | null;
}

/**
 * The runtime end a live session (stdin kept open, see `ClaudeCodeLiveInput`)
 * reports once, at process exit: complete, or interrupted when its last turn
 * was stopped. Only a clean exit after a finished turn ends the run here — a
 * crash after a result is a failure, not a completion. Print mode exits 1 when
 * its last turn was an error result, which an interrupt is.
 *
 * Shared by every host of a live CLI (`lh hetero exec`, the desktop's local
 * spawn) so they end a run by the same rule.
 *
 * @returns the `completeRuntime` data, or undefined when the run does not end here
 */
export const resolveClaudeCodeLiveRuntimeEnd = (
  lastTurn: ClaudeCodeTurnOutcome | undefined,
  exit: ClaudeCodeLiveExit,
): Record<string, unknown> | undefined => {
  if (!lastTurn || exit.killedByHost || exit.sawError) return;

  const cleanExit =
    exit.code === 0 || (lastTurn.aborted && exit.code === 1 && exit.signal === null);
  if (!cleanExit) return;

  const end = lastTurn.aborted
    ? { kind: 'aborted', reason: 'interrupted', terminalReason: lastTurn.terminalReason }
    : { reason: 'complete' };
  return { ...end, transport: 'cli-live' };
};

/**
 * The `request` of a stream-json `control_request` line, e.g.
 * `{ subtype: 'interrupt' }`. Claude Code answers each one with a
 * `control_response` carrying the same `request_id`.
 */
export interface ClaudeCodeControlRequest {
  [key: string]: unknown;
  subtype: string;
}

/** Claude Code's answer to a control request. */
export type ClaudeCodeControlResponse =
  { response?: Record<string, unknown>; subtype: 'success' } | { error: string; subtype: 'error' };

/** A control request written to the session, and its answer once it comes. */
export interface ClaudeCodeControlRequestHandle {
  requestId: string;
  /**
   * Claude Code's `control_response`. Never rejects: a session whose output
   * ends first answers `{ subtype: 'error' }`. Claude Code may not answer a
   * subtype it does not know, so a caller that needs an answer bounds the wait.
   */
  response: Promise<ClaudeCodeControlResponse>;
}

const SESSION_ENDED: ClaudeCodeControlResponse = {
  error: 'The session ended before answering',
  subtype: 'error',
};

export interface ClaudeCodeLiveInputOptions {
  idleCloseMs?: number;
  wakeUpGraceMs?: number;
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
 * picked up yet.
 *
 * A task that ends between turns does not make the session idle: its
 * notification wakes the main agent for a turn, and that turn can start a new
 * task or resume a finished sub-agent with `SendMessage`. Closing at the end
 * would put those tasks under the ceiling, so the decision waits for the
 * wake-up turn's result.
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
  private readonly pendingControl = new Map<string, (answer: ClaudeCodeControlResponse) => void>();
  private turnOpen = true;
  private readonly unconsumed = new Set<string>();
  private readonly wakeUpGraceMs: number;
  private wakeUpTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly stdin: Writable,
    options: ClaudeCodeLiveInputOptions = {},
  ) {
    this.idleCloseMs = options.idleCloseMs ?? readIdleCloseMs();
    this.wakeUpGraceMs = options.wakeUpGraceMs ?? DEFAULT_WAKE_UP_GRACE_MS;
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
    return !!this.sendControlRequest({ subtype: 'interrupt' });
  }

  /**
   * Write a stream-json `control_request` into the session — the protocol
   * Claude Code's SDK uses to steer a live process (interrupt, stop a task,
   * change the model…).
   *
   * @returns the request and its answer, or `undefined` once input has closed
   */
  sendControlRequest(
    request: ClaudeCodeControlRequest,
  ): ClaudeCodeControlRequestHandle | undefined {
    if (this.closed) return;

    const requestId = randomUUID();
    const response = new Promise<ClaudeCodeControlResponse>((resolve) => {
      this.pendingControl.set(requestId, resolve);
    });
    this.stdin.write(
      `${JSON.stringify({ request, request_id: requestId, type: 'control_request' })}\n`,
    );
    return { requestId, response };
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
    // Nothing can answer a control request any more.
    for (const resolve of this.pendingControl.values()) resolve(SESSION_ENDED);
    this.pendingControl.clear();
  }

  close(): void {
    if (this.closed) return;

    this.markClosed();
    this.stdin.end();
  }

  private observeMessage(message: any): void {
    if (message?.type === 'control_response') {
      this.observeControlResponse(message.response);
      return;
    }
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

  /** Answers arrive even after input closed, for requests written before. */
  private observeControlResponse(response: any): void {
    const requestId = response?.request_id;
    const resolve = typeof requestId === 'string' && this.pendingControl.get(requestId);
    if (!resolve) return;

    this.pendingControl.delete(requestId);
    resolve(
      response.subtype === 'success'
        ? { response: response.response ?? undefined, subtype: 'success' }
        : { error: String(response.error ?? 'Control request failed'), subtype: 'error' },
    );
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
      // Claude Code wakes the model for a task that ended on its own, never for
      // one that was stopped: nothing is left to wait for.
      const stopped =
        message.patch?.status === 'killed' ||
        (message.subtype === 'task_notification' && message.status === 'stopped');
      if (stopped) this.closeIfIdle();
      else this.awaitWakeUpTurn();
    }
  }

  /** A newer turn supersedes how the last one ended until it reports its own. */
  private openTurn(): void {
    this.turnOpen = true;
    this.lastOutcome = undefined;
    this.clearWakeUpTimer();
  }

  private closeIfIdle(): void {
    if (this.turnOpen || this.activeTasks.size > 0 || this.unconsumed.size > 0) return;
    this.close();
  }

  /**
   * The last task ended between turns. The turn its notification wakes decides
   * at its result; close here only if no turn opens within the grace.
   */
  private awaitWakeUpTurn(): void {
    if (this.closed) return;
    if (this.turnOpen || this.activeTasks.size > 0 || this.unconsumed.size > 0) return;

    this.clearWakeUpTimer();
    this.wakeUpTimer = setTimeout(() => this.closeIfIdle(), this.wakeUpGraceMs);
    this.wakeUpTimer.unref?.();
  }

  private clearWakeUpTimer(): void {
    if (!this.wakeUpTimer) return;

    clearTimeout(this.wakeUpTimer);
    this.wakeUpTimer = undefined;
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
    this.clearWakeUpTimer();
  }
}
