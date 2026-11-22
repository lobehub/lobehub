import type { Writable } from 'node:stream';

/**
 * How long a live Antigravity session may sit between turns with no stdout
 * before stdin is closed anyway.
 */
const DEFAULT_IDLE_CLOSE_MS = 30 * 60 * 1000;

const readIdleCloseMs = (): number => {
  const value = Number(process.env.LOBE_ANTIGRAVITY_LIVE_INPUT_IDLE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_IDLE_CLOSE_MS;
};

/** How the session's most recent turn ended. */
export interface AntigravityTurnOutcome {
  ok: boolean;
  status?: string;
}

/** How a live Antigravity process ended, as its host saw it. */
export interface AntigravityLiveExit {
  code: number | null;
  /** The host killed the process (cancel, stop, quit): its own path reports that end. */
  killedByHost: boolean;
  /** The run already reported an error event: that error is its end. */
  sawError: boolean;
  signal: NodeJS.Signals | null;
}

/**
 * The runtime end a live Antigravity session (stdin kept open, see
 * `AntigravityLiveInput`) reports once, at process exit.
 */
export const resolveAntigravityLiveRuntimeEnd = (
  lastTurn: AntigravityTurnOutcome | undefined,
  exit: AntigravityLiveExit,
): Record<string, unknown> | undefined => {
  if (!lastTurn?.ok || exit.killedByHost || exit.sawError) return;
  if (exit.code !== 0) return;

  return { reason: 'complete', transport: 'cli-live' };
};

export interface AntigravityLiveInputOptions {
  idleCloseMs?: number;
}

/**
 * Keeps an Antigravity (`--input-format stream-json --output-format stream-json`)
 * stdin open while a turn is active or steered follow-ups remain unconsumed,
 * then closes stdin as soon as the session becomes idle so the process exits cleanly.
 */
export class AntigravityLiveInput {
  private closed = false;
  private readonly idleCloseMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private initialUserInputSeen = false;
  private lastOutcome: AntigravityTurnOutcome | undefined;
  private lineBuffer = '';
  private readonly pendingAdapterUuids: string[] = [];
  private readonly seenUserInputSteps = new Set<number>();
  private sessionId: string | undefined;
  private turnOpen = false;
  private readonly unconsumed: string[] = [];

  constructor(
    private readonly stdin: Writable,
    options: AntigravityLiveInputOptions = {},
  ) {
    this.idleCloseMs = options.idleCloseMs ?? readIdleCloseMs();
    stdin.on?.('close', () => this.markClosed());
    stdin.on?.('error', () => this.markClosed());
  }

  get isOpen(): boolean {
    return !this.closed && !this.stdin.destroyed && !this.stdin.writableEnded;
  }

  get lastTurn(): AntigravityTurnOutcome | undefined {
    return this.lastOutcome;
  }

  /**
   * Write one stream-json `user` line into the session. When `uuid` is given
   * (a steered follow-up), stdin stays open across turn boundaries until `agy`
   * picks up that message and finishes its turn.
   */
  send(stdinLine: string, uuid?: string): boolean {
    if (!this.isOpen) return false;
    if (uuid) {
      this.unconsumed.push(uuid);
      this.pendingAdapterUuids.push(uuid);
    }
    this.stdin.write(stdinLine);
    this.clearIdleTimer();
    return true;
  }

  /** Pop the next steered message UUID for `AntigravityAdapter` to confirm. */
  takeSteerUuid(): string | undefined {
    return this.pendingAdapterUuids.shift();
  }

  /** Feed raw stdout bytes from the child process. */
  observe(chunk: string | Buffer): void {
    this.lineBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    for (;;) {
      const newline = this.lineBuffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.lineBuffer.slice(0, newline).trim();
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      if (!line) continue;

      try {
        this.observeMessage(JSON.parse(line));
      } catch {
        // Non-JSON diagnostics are ignored by the adapter too.
      }
    }

    if (this.closed) return;
    if (this.turnOpen) this.clearIdleTimer();
    else this.armIdleTimer();
  }

  /** stdout ended: flush any trailing partial line and close stdin. */
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
    if (!message || typeof message !== 'object') return;

    if (message.event === 'init') {
      if (typeof message.conversation_id === 'string' && message.conversation_id) {
        this.sessionId = message.conversation_id;
      }
      this.openTurn();
      return;
    }

    if (message.event === 'step_update' && message.step_update && typeof message.step_update === 'object') {
      const step = message.step_update;
      const conversationId =
        typeof step.conversation_id === 'string' && step.conversation_id
          ? step.conversation_id
          : undefined;
      // Child conversations must never consume the parent run's pending steer count.
      if (this.sessionId && conversationId && conversationId !== this.sessionId) return;
      this.sessionId ??= conversationId;
      if (step.step_type === 'user_input') {
        const index = typeof step.step_index === 'number' ? step.step_index : undefined;
        const isNewStep = index === undefined || !this.seenUserInputSteps.has(index);
        if (isNewStep) {
          if (index !== undefined) this.seenUserInputSteps.add(index);
          if (this.initialUserInputSeen) {
            this.unconsumed.shift();
          } else {
            this.initialUserInputSeen = true;
          }
        }
      }
      this.openTurn();
      return;
    }

    if (message.event === 'result' && message.result && typeof message.result === 'object') {
      this.turnOpen = false;
      const status = typeof message.result.status === 'string' ? message.result.status : undefined;
      this.lastOutcome = { ok: status === 'SUCCESS', status };
      if (status !== 'SUCCESS') this.close();
      else this.closeIfIdle();
    }
  }

  private openTurn(): void {
    this.turnOpen = true;
    this.lastOutcome = undefined;
  }

  private closeIfIdle(): void {
    if (this.turnOpen || this.unconsumed.length > 0) return;
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
