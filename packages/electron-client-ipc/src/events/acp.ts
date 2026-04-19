// ============================================================
// External Agent broadcast event types (main → renderer)
// ============================================================

export interface ACPBroadcastEvents {
  /**
   * Raw JSON line from agent's stdout.
   * Renderer side uses an Adapter to parse into AgentStreamEvent.
   */
  acpRawLine: (data: { line: any; sessionId: string }) => void;

  /** Agent session completed successfully (process exited 0). */
  acpSessionComplete: (data: { sessionId: string }) => void;

  /** Agent session errored (process exited non-zero or threw). */
  acpSessionError: (data: { error: string; sessionId: string }) => void;
}
