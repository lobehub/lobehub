import type { AgentStreamEvent, SessionStatus } from './types';

/**
 * How long after a mirrored member's `agent_runtime_end` a session-ending
 * signal is still read as that member's echo. The gateway emits the echo within
 * milliseconds of the member terminal; a genuine end of the owning session
 * (watchdog, explicit status update) arrives on its own, much later.
 */
export const MIRRORED_TERMINAL_ECHO_WINDOW_MS = 5000;

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
export class MirroredTerminalEchoGuard {
  private foreignTerminalAt: number | undefined;
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
    private readonly now: () => number = Date.now,
  ) {}

  /** Record an incoming agent event. */
  observe(event: AgentStreamEvent): void {
    const isOwn = !event.operationId || event.operationId === this.operationId;
    if (isOwn) {
      // The owner is demonstrably alive after the member ended.
      this.foreignTerminalAt = undefined;
      if (event.type === 'agent_runtime_end' || event.type === 'error') {
        this.replayForeignStatus = undefined;
      }
      return;
    }
    if (event.type === 'agent_runtime_end') {
      this.foreignTerminalAt = this.now();
      this.replayForeignStatus = sessionStatusOf(event);
    }
  }

  /** A resume / (re)subscribe is starting: only what it replays counts from here. */
  beginReplay(): void {
    this.replayForeignStatus = undefined;
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

  /** Whether a session-ending signal arriving now is a mirrored terminal's echo. */
  isEcho(): boolean {
    // Not one-shot: protocol v2 echoes a member terminal twice (the lifecycle
    // `status_change` and the forwarded `session_complete`).
    if (this.foreignTerminalAt === undefined) return false;
    return this.now() - this.foreignTerminalAt <= MIRRORED_TERMINAL_ECHO_WINDOW_MS;
  }
}
