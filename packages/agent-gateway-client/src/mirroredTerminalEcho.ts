import type { AgentStreamEvent } from './types';

/**
 * How long after a mirrored member's `agent_runtime_end` a session-ending
 * signal is still read as that member's echo. The gateway emits the echo within
 * milliseconds of the member terminal; a genuine end of the owning session
 * (watchdog, explicit status update) arrives on its own, much later.
 */
export const MIRRORED_TERMINAL_ECHO_WINDOW_MS = 5000;

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
      return;
    }
    if (event.type === 'agent_runtime_end') this.foreignTerminalAt = this.now();
  }

  /** Whether a session-ending signal arriving now is a mirrored terminal's echo. */
  isEcho(): boolean {
    // Not one-shot: protocol v2 echoes a member terminal twice (the lifecycle
    // `status_change` and the forwarded `session_complete`).
    if (this.foreignTerminalAt === undefined) return false;
    return this.now() - this.foreignTerminalAt <= MIRRORED_TERMINAL_ECHO_WINDOW_MS;
  }
}
