import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { OperationState } from './types';

/**
 * Stable 32-bit FNV-1a hash of a string. Cheap to compute, collision odds are
 * negligible at this scope (a few thousand events per operation), and the
 * output is short enough to keep the per-operation `processedKeys` set small.
 */
const fnv1a = (input: string): string => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // FNV prime 0x01000193, applied via bit shifts to stay in 32-bit math.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
};

/**
 * Per-event idempotency key. CLI BatchIngester retries the SAME event objects
 * on transient failures, so the same `(stepIndex, type, data)` triple is
 * stable across retries — and distinct between back-to-back events even when
 * they share a millisecond timestamp.
 *
 * Why not just `(stepIndex, type, timestamp)`: producers stamp events with
 * `Date.now()` (see `claudeCode.ts` / `codex.ts` adapters), and CC bursts
 * multiple `stream_chunk` events through the same step within a single
 * millisecond. Without a content fingerprint, later chunks would collide with
 * earlier ones, get treated as duplicates, and be dropped — silently
 * truncating assistant output.
 *
 * Why not hash full `data`: tools_calling payloads can carry large argument
 * strings; a stable JSON.stringify on every event is cheap enough but the
 * resulting key would balloon the `processedKeys` set. Hashing keeps the key
 * bounded.
 */
export const eventKey = (event: AgentStreamEvent): string => {
  // Fingerprint the data via stable JSON. Order is irrelevant — adapters
  // produce events with consistent key order, and even if they didn't, the
  // important property is "same event input → same output", which holds.
  const dataJson = (() => {
    try {
      return JSON.stringify(event.data ?? null);
    } catch {
      // Cyclic / unstringifiable payload: fall back to a coarse fingerprint.
      // Real wire data is always JSON-serializable, so this branch only fires
      // on bad test inputs.
      return String(typeof event.data);
    }
  })();
  return `${event.stepIndex}:${event.type}:${event.timestamp}:${fnv1a(dataJson)}`;
};

/**
 * Module-level singleton: `Map<operationId, OperationState>`. Service
 * instances are constructed per-request via the tRPC procedure middleware,
 * so per-instance state would not survive across requests. Keying off the
 * shared map lets two ingest batches for the same operationId share their
 * tool map / accumulated content / subagent runs.
 */
export const operationStates = new Map<string, OperationState>();

/** Test-only reset hook to clear the singleton between specs. */
export const __resetOperationStatesForTesting = () => operationStates.clear();

export class StaleHeteroOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleHeteroOperationError';
  }
}
