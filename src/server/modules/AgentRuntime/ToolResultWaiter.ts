import debug from 'debug';
import type { Redis } from 'ioredis';

const log = debug('lobe-server:agent-runtime:tool-result-waiter');

export interface ToolResultPayload {
  content: string | null;
  error?: {
    message: string;
    type?: string;
  };
  success: boolean;
  toolCallId: string;
}

const CANCEL_SENTINEL = '__tool_result_cancelled__';

const resultKey = (toolCallId: string) => `tool_result:${toolCallId}`;

/**
 * Block-awaits tool results that arrive via Redis LPUSH (from the tool-result
 * callback API). Wraps Redis BLPOP with Promise semantics + cancellation.
 *
 * The constructor expects a dedicated blocking Redis connection (use
 * `ioredis.duplicate()`); BLPOP blocks the underlying socket so it must not
 * share a connection with business traffic, and it must not be used by more
 * than one waiter at the same time.
 */
export class ToolResultWaiter {
  private readonly blockingClient: Redis;
  private readonly producingClient: Redis;

  /**
   * @param blockingClient  Dedicated connection used exclusively for BLPOP.
   * @param producingClient Connection used for LPUSH side effects (e.g.
   *                        `cancel`). Typically the shared agent runtime client.
   */
  constructor(blockingClient: Redis, producingClient: Redis) {
    this.blockingClient = blockingClient;
    this.producingClient = producingClient;
  }

  /**
   * Wait for a single tool result.
   *
   * @returns The parsed payload, or `null` on timeout/cancel.
   */
  async waitForResult(toolCallId: string, timeoutMs: number): Promise<ToolResultPayload | null> {
    const [result] = await this.waitForResults([toolCallId], timeoutMs);
    return result ?? null;
  }

  /**
   * Wait for a batch of tool results sharing a single blocking connection.
   *
   * Uses Redis's multi-key BLPOP (`BLPOP key1 key2 ... timeout`) in a loop
   * with a shared deadline, so total wait is bounded by `timeoutMs` rather
   * than `N * timeoutMs`. Results are aligned with the input order; slots
   * that time out or receive a cancel sentinel are `null`.
   */
  async waitForResults(
    toolCallIds: string[],
    timeoutMs: number,
  ): Promise<Array<ToolResultPayload | null>> {
    if (toolCallIds.length === 0) return [];

    const idByKey = new Map<string, string>();
    for (const id of toolCallIds) idByKey.set(resultKey(id), id);

    const results = new Map<string, ToolResultPayload | null>();
    const pendingKeys = new Set(idByKey.keys());
    const deadline = Date.now() + timeoutMs;

    while (pendingKeys.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      const timeoutSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      const keys = [...pendingKeys];
      log('BLPOP multi %o timeout=%ds', keys, timeoutSeconds);

      // ioredis variadic signature: blpop(key1, key2, ..., timeoutSeconds).
      const popped = (await (
        this.blockingClient.blpop as unknown as (
          ...args: (string | number)[]
        ) => Promise<[string, string] | null>
      )(...keys, timeoutSeconds)) as [string, string] | null;

      if (!popped) {
        log('BLPOP multi timed out with %d key(s) remaining', pendingKeys.size);
        break;
      }

      const [key, raw] = popped;
      const id = idByKey.get(key);
      if (!id) continue; // Defensive: unexpected key, skip
      pendingKeys.delete(key);

      if (raw === CANCEL_SENTINEL) {
        log('BLPOP %s cancelled', key);
        results.set(id, null);
        continue;
      }

      try {
        results.set(id, JSON.parse(raw) as ToolResultPayload);
      } catch (error) {
        log('Failed to parse tool result for %s: %O', id, error);
        results.set(id, null);
      }
    }

    return toolCallIds.map((id) => results.get(id) ?? null);
  }

  /**
   * Cancel a pending waiter by LPUSHing a poison-pill so the BLPOP wakes up.
   * Safe to call even if no waiter is active — the sentinel will expire.
   */
  async cancel(toolCallId: string): Promise<void> {
    const key = resultKey(toolCallId);
    await this.producingClient.pipeline().lpush(key, CANCEL_SENTINEL).expire(key, 60).exec();
    log('Cancel sentinel pushed to %s', key);
  }
}
