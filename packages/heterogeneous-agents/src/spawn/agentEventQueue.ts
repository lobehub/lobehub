import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

interface EventQueue {
  [Symbol.asyncIterator]: () => AsyncIterator<AgentStreamEvent>;
  close: () => void;
  push: (batch: AgentStreamEvent[]) => void;
}

/**
 * Bridges agent event batches to an ordered, buffered async iterator.
 *
 * Use when:
 * - A native RPC session pushes events into the CLI's pull-based ingest loop.
 * Expects:
 * - Producers close the queue after their final event.
 * Returns:
 * - Every queued event in arrival order, followed by iterator completion.
 */
export const createEventQueue = (): EventQueue => {
  const items: AgentStreamEvent[] = [];
  const waiters: Array<() => void> = [];
  let closed = false;

  const notify = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  return {
    push(batch) {
      items.push(...batch);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length > 0) {
          yield items.shift()!;
        }
        if (closed) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
};
