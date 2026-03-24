import debug from 'debug';

const log = debug('lobe-server:bot:typing-keepalive');

const TYPING_INTERVAL_MS = 4000;

/**
 * In-memory registry of active typing intervals.
 * Keyed by platformThreadId so both AgentBridgeService (start)
 * and BotCallbackService (stop) can reference the same entry.
 */
const activeIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Start a repeating typing indicator for a thread.
 * Calls `typingFn` immediately, then every TYPING_INTERVAL_MS.
 * Returns a cleanup function (also accessible via `stopTypingKeepAlive`).
 */
export function startTypingKeepAlive(threadId: string, typingFn: () => Promise<void>): () => void {
  // Clear any existing interval for this thread (safety)
  stopTypingKeepAlive(threadId);

  log('start: threadId=%s, interval=%dms', threadId, TYPING_INTERVAL_MS);

  const interval = setInterval(() => {
    typingFn().catch(() => {
      // Typing failures are non-critical — ignore silently
    });
  }, TYPING_INTERVAL_MS);

  activeIntervals.set(threadId, interval);

  return () => stopTypingKeepAlive(threadId);
}

/**
 * Stop the typing keepalive for a thread.
 * Safe to call even if no interval is active.
 */
export function stopTypingKeepAlive(threadId: string): void {
  const interval = activeIntervals.get(threadId);
  if (interval) {
    clearInterval(interval);
    activeIntervals.delete(threadId);
    log('stop: threadId=%s', threadId);
  }
}
