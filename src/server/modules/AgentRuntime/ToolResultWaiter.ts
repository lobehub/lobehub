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
 * share a connection with business traffic.
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
    const key = resultKey(toolCallId);
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

    log('BLPOP %s timeout=%ds', key, timeoutSeconds);
    const popped = await this.blockingClient.blpop(key, timeoutSeconds);

    if (!popped) {
      log('BLPOP %s timed out', key);
      return null;
    }

    const [, raw] = popped;

    if (raw === CANCEL_SENTINEL) {
      log('BLPOP %s cancelled', key);
      return null;
    }

    try {
      const payload = JSON.parse(raw) as ToolResultPayload;
      return payload;
    } catch (error) {
      log('Failed to parse tool result for %s: %O', toolCallId, error);
      return null;
    }
  }

  /**
   * Wait for a batch of tool results concurrently. Returns results aligned
   * with the input order; timed-out / cancelled slots are `null`.
   */
  async waitForResults(
    toolCallIds: string[],
    timeoutMs: number,
  ): Promise<Array<ToolResultPayload | null>> {
    return Promise.all(toolCallIds.map((id) => this.waitForResult(id, timeoutMs)));
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
