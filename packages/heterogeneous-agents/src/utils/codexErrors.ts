/** Capacity failures are transient and use the same retry policy as CC overloads. */
export const isCodexCapacityError = (message: string): boolean =>
  /\bselected model is at capacity\b/i.test(message);

/**
 * Codex reports an in-flight stream retry with the same JSONL `error` event it
 * uses for fatal failures (`EventMsg::StreamError` → "Reconnecting... 2/5",
 * "Reconnecting... waiting for network"), and the exec JSONL form carries no
 * `willRetry` flag — only `turn.failed` ends the turn. Codex itself keeps
 * `CodexStatus::Running` after emitting one, so treating it as terminal kills a
 * turn that is still going to complete.
 */
export const isCodexTransientStreamError = (message: string): boolean =>
  /\breconnecting\b/i.test(message) || /\bwaiting for network\b/i.test(message);
