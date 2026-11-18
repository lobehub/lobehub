import type {
  MessageBatchOperation,
  MessageQueryContext,
  messageService,
} from '@/services/message';

export const HETERO_MESSAGE_WRITE_BATCH_IDLE_MS = 5_000;
/**
 * Upper bound of ONE `batchMutate` request, not just the auto-flush trigger. The
 * lambda router rejects a request over 200 operations as a whole (400), so a
 * backlog sent in one piece lost every create in it.
 */
export const HETERO_MESSAGE_WRITE_BATCH_MAX_OPS = 50;
/**
 * Serialized-payload budget of one `batchMutate` request. Vercel rejects request
 * bodies over 4.5 MB (413) and tRPC may batch other procedures into the same HTTP
 * request, so stay well below it. A single larger operation is still sent alone.
 */
export const HETERO_MESSAGE_WRITE_BATCH_MAX_BYTES = 2 * 1024 * 1024;

const textEncoder = new TextEncoder();

/** Byte size of the fields `messageService.batchMutate` actually sends. */
const estimateOperationBytes = (operation: QueuedMessageWriteOperation) =>
  textEncoder.encode(
    JSON.stringify(
      operation.type === 'createMessage'
        ? { message: operation.message, type: operation.type }
        : { id: operation.id, type: operation.type, value: operation.value },
    ),
  ).length;

type MessageUpdateOperation = Extract<MessageBatchOperation, { type: 'updateMessage' }>;
export type ToolMessageUpdateOperation = Extract<
  MessageBatchOperation,
  { type: 'updateToolMessage' }
>;

export type QueuedMessageWriteOperation =
  | (Extract<MessageBatchOperation, { type: 'createMessage' }> & {
      ctx?: never;
      onFailure?: (error: unknown) => void;
    })
  | (MessageUpdateOperation & {
      ctx?: MessageQueryContext;
      onFailure?: (error: unknown) => void;
    })
  | (ToolMessageUpdateOperation & {
      ctx?: MessageQueryContext;
      onFailure?: (error: unknown) => void;
    });

const mergeMessageUpdateValue = (
  previous: MessageUpdateOperation['value'],
  next: MessageUpdateOperation['value'],
): MessageUpdateOperation['value'] => {
  const metadata =
    previous.metadata || next.metadata
      ? {
          ...(previous.metadata as Record<string, any> | undefined),
          ...(next.metadata as Record<string, any> | undefined),
        }
      : undefined;

  return {
    ...previous,
    ...next,
    ...(metadata ? { metadata } : {}),
  };
};

/**
 * Write-behind queue for the hetero run's message rows: coalesces consecutive
 * updates to the same row and flushes them as one `batchMutate`.
 *
 * Failures are reported ONLY through each operation's `onFailure` — `flush`
 * resolves either way. Callers that depend on a row actually existing (an FK
 * parent, say) therefore cannot treat an awaited `flush` as proof it landed;
 * they must track the failures themselves. See `pendingCreates` in the executor.
 */
export const createMessageWriteBatcher = (deps: {
  batchMutate?: (operations: MessageBatchOperation[]) => Promise<any>;
  /**
   * Runs before each batch is sent. The executor uses it to retry creates that
   * just failed, so the next batch's children find their FK parent instead of
   * failing one after another until the run's terminal replay.
   */
  beforeBatch?: () => Promise<void>;
  createMessage: typeof messageService.createMessage;
  /** Ids of rows whose create the server acknowledged. */
  onCreated?: (ids: string[]) => void;
  updateMessage: typeof messageService.updateMessage;
  updateToolMessage: typeof messageService.updateToolMessage;
}) => {
  const operations: QueuedMessageWriteOperation[] = [];
  let flushChain: Promise<void> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const notifyFailure = (operation: QueuedMessageWriteOperation, error: unknown) => {
    operation.onFailure?.(error);
  };

  const reportCreated = (succeeded: QueuedMessageWriteOperation[]) => {
    const ids = succeeded.flatMap((operation) =>
      operation.type === 'createMessage' && operation.message.id ? [operation.message.id] : [],
    );
    if (ids.length > 0) deps.onCreated?.(ids);
  };

  const runIndividual = async (operation: QueuedMessageWriteOperation) => {
    if (operation.type === 'createMessage') {
      await deps.createMessage(operation.message);
      reportCreated([operation]);
      return;
    }

    if (operation.type === 'updateToolMessage') {
      const result = await deps.updateToolMessage(operation.id, operation.value, operation.ctx);
      if (result?.success === false) notifyFailure(operation, result);
      return;
    }

    const result = await deps.updateMessage(operation.id, operation.value, operation.ctx);
    if (result?.success === false) notifyFailure(operation, result);
  };

  const runBatch = async (batch: QueuedMessageWriteOperation[]) => {
    if (deps.batchMutate) {
      try {
        const result = await deps.batchMutate(batch as unknown as MessageBatchOperation[]);
        const failedIndexes = new Set<number>(
          (result?.results ?? [])
            .filter((item: { index: number; success: boolean }) => !item.success)
            .map((item: { index: number }) => item.index),
        );

        if (result?.success === false && failedIndexes.size === 0) {
          for (const [index] of batch.entries()) failedIndexes.add(index);
        }

        for (const index of failedIndexes) {
          notifyFailure(batch[index], result);
        }
        reportCreated(batch.filter((_, index) => !failedIndexes.has(index)));
        return;
      } catch (err) {
        console.error('[HeterogeneousAgent] Failed to flush message write batch:', err);
        for (const operation of batch) notifyFailure(operation, err);
        return;
      }
    }

    for (const operation of batch) {
      try {
        await runIndividual(operation);
      } catch (err) {
        console.error('[HeterogeneousAgent] Failed to flush message write operation:', err);
        notifyFailure(operation, err);
      }
    }
  };

  /**
   * Take the next request's worth of operations off the queue. While a request is
   * in flight the queue keeps growing, so the backlog must be split here rather
   * than relying on the max-ops auto-flush to keep it small.
   */
  const takeBatch = () => {
    let bytes = 0;
    let count = 0;
    for (const operation of operations) {
      if (count >= HETERO_MESSAGE_WRITE_BATCH_MAX_OPS) break;
      const size = estimateOperationBytes(operation);
      if (count > 0 && bytes + size > HETERO_MESSAGE_WRITE_BATCH_MAX_BYTES) break;
      bytes += size;
      count += 1;
    }
    return operations.splice(0, count);
  };

  const runBeforeBatch = async () => {
    try {
      await deps.beforeBatch?.();
    } catch (err) {
      console.error('[HeterogeneousAgent] beforeBatch hook failed:', err);
    }
  };

  const flush = async (_reason: string) => {
    clearIdleTimer();
    flushChain = flushChain.then(async () => {
      while (operations.length > 0) {
        await runBeforeBatch();
        await runBatch(takeBatch());
      }
    });
    await flushChain;
  };

  const scheduleIdleFlush = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      void flush('idle');
    }, HETERO_MESSAGE_WRITE_BATCH_IDLE_MS);
  };

  const enqueue = (operation: QueuedMessageWriteOperation) => {
    const last = operations.at(-1);
    if (
      last?.type === 'updateMessage' &&
      operation.type === 'updateMessage' &&
      last.id === operation.id &&
      !last.onFailure &&
      !operation.onFailure
    ) {
      last.value = mergeMessageUpdateValue(last.value, operation.value);
    } else {
      operations.push(operation);
    }

    if (operations.length >= HETERO_MESSAGE_WRITE_BATCH_MAX_OPS) {
      void flush('max-ops');
    } else {
      scheduleIdleFlush();
    }
  };

  return {
    enqueueCreateMessage: (
      message: Extract<MessageBatchOperation, { type: 'createMessage' }>['message'],
      onFailure?: (error: unknown) => void,
    ) => enqueue({ message, onFailure, type: 'createMessage' }),
    enqueueToolMessageUpdate: (
      id: string,
      value: ToolMessageUpdateOperation['value'],
      ctx?: MessageQueryContext,
      onFailure?: (error: unknown) => void,
    ) => enqueue({ ctx, id, onFailure, type: 'updateToolMessage', value }),
    enqueueUpdateMessage: (
      id: string,
      value: MessageUpdateOperation['value'],
      ctx?: MessageQueryContext,
      onFailure?: (error: unknown) => void,
    ) => enqueue({ ctx, id, onFailure, type: 'updateMessage', value }),
    flush,
  };
};
