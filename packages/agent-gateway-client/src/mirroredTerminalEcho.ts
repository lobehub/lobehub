import type { AgentStreamEvent, SessionStatus } from './types';

/** The status the gateway DO derives from an `agent_runtime_end` (see `AgentOperationDO.pushEvent`). */
const sessionStatusOf = (event: AgentStreamEvent): SessionStatus => {
  const reason = (event.data as { reason?: string } | undefined)?.reason;
  return reason === 'error' ? 'error' : reason === 'interrupted' ? 'interrupted' : 'completed';
};

/**
 * Recognizes a session end that was caused by ANOTHER operation's terminal.
 *
 * A group member's events are mirrored onto the supervisor's channel. Servers
 * that predate `member_runtime_end` mirror the member's terminal verbatim, and
 * gateway builds that end a session on any `agent_runtime_end` then answer it
 * with `session_complete` (or a terminal lifecycle status) for the supervisor —
 * even though the supervisor is still running. Treating that as the owner's end
 * cut the supervisor stream short, cleared its running mark and dropped its
 * queued follow-ups.
 */
/** A session-ending signal a gateway echoes for a mirrored member terminal. */
export type MirroredTerminalEchoSignal = 'session_complete' | 'status_change';

/** Which gateway protocol the guarded subscription speaks. */
export type MirroredTerminalEchoProtocol = 'v1' | 'v2';

/**
 * The echoes a gateway sends for an `agent_runtime_end` that left `status`.
 * v1 answers every ending with `session_complete`. v2 sends a terminal
 * `status_change` carrying the status for `error` / `interrupted`, and
 * `session_complete` for `completed` (PROTOCOL_V2.md §6) — plus, from builds
 * that still send both, a `status_change{completed}`. Tolerating that one is
 * safe: the owner's own completion arrives with its own `agent_runtime_end`
 * (which clears everything owed) or ends on the `session_complete` after it.
 */
const echoKeysOf = (protocol: MirroredTerminalEchoProtocol, status: SessionStatus): string[] => {
  if (protocol === 'v1') return ['session_complete'];
  return status === 'completed'
    ? ['session_complete', 'status_change:completed']
    : [`status_change:${status}`];
};

export class MirroredTerminalEchoGuard {
  /**
   * Echoes still owed for verbatim foreign terminals, keyed by the exact signal
   * (see `echoKeysOf`). Counted by message
   * order, not wall-clock time: a suspended tab or renderer delivers the echo
   * late but still in order. Only the signal that will actually arrive is owed,
   * so nothing stays armed to swallow the owner's own end. An owner event proves
   * the owner alive and clears it; so does a new resume.
   */
  private pendingEchoes = new Map<string, number>();
  /**
   * The session status another operation's `agent_runtime_end` REPLAYED BY THE
   * CURRENT RESUME would have left on this channel's DO, while no terminal of
   * our own has arrived since. Scoped to one resume on purpose: only a replay
   * that still carries the member's terminal proves the buffer after it is
   * intact — a terminal seen before a disconnect proves nothing once the DO may
   * have hibernated away the owner's own terminal.
   */
  private replayForeignStatus: SessionStatus | undefined;

  constructor(
    private readonly operationId: string,
    private readonly protocol: MirroredTerminalEchoProtocol = 'v1',
  ) {}

  /** Record an incoming agent event. */
  observe(event: AgentStreamEvent): void {
    const isOwn = !event.operationId || event.operationId === this.operationId;
    if (isOwn) {
      // The owner is demonstrably alive after the member ended.
      this.clearPendingEchoes();
      if (event.type === 'agent_runtime_end' || event.type === 'error') {
        this.replayForeignStatus = undefined;
      }
      return;
    }
    if (event.type === 'agent_runtime_end') {
      const status = sessionStatusOf(event);
      for (const key of echoKeysOf(this.protocol, status)) {
        this.pendingEchoes.set(key, (this.pendingEchoes.get(key) ?? 0) + 1);
      }
      this.replayForeignStatus = status;
    }
  }

  /** A resume / (re)subscribe is starting: only what it replays counts from here. */
  beginReplay(): void {
    this.replayForeignStatus = undefined;
    // An echo not yet received on the old connection is not owed on this one.
    this.clearPendingEchoes();
  }

  /**
   * Whether a terminal status reported on resume is the one a mirrored member
   * terminal left on this DO. Such a gateway sets its status on ANY
   * `agent_runtime_end` and never resets it on later events, so a (re)subscribe
   * after a member ended reads the supervisor as finished while it still runs —
   * even when supervisor events were replayed after the member's end.
   *
   * Only trusted when this resume replayed that member terminal and nothing was
   * dropped (`gap`): the buffer only loses its oldest events, so the member's
   * terminal still being there means any later owner terminal would be too.
   * Without that provenance — an empty replay after hibernation, a gapped
   * replay, a member terminal only seen before the disconnect — the DO's
   * authoritative status wins. So does any other status (a watchdog's `error`).
   */
  isStaleResumeStatus(status: SessionStatus | undefined, options?: { gap?: boolean }): boolean {
    if (options?.gap) return false;
    return this.replayForeignStatus !== undefined && status === this.replayForeignStatus;
  }

  /**
   * Whether a session-ending signal arriving now is a mirrored terminal's echo.
   * Consumes one owed echo of that kind, so a genuine end arriving after the
   * echoes (a watchdog's status, the owner's own session end) is honored.
   */
  consumeEcho(signal: MirroredTerminalEchoSignal, status?: SessionStatus): boolean {
    const key = signal === 'status_change' ? `status_change:${status}` : signal;
    const owed = this.pendingEchoes.get(key) ?? 0;
    if (owed === 0) return false;
    if (owed === 1) this.pendingEchoes.delete(key);
    else this.pendingEchoes.set(key, owed - 1);
    return true;
  }

  private clearPendingEchoes(): void {
    this.pendingEchoes.clear();
  }
}
