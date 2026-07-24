import type {
  MessageBatchOperation,
  MessageQueryContext,
  messageService,
} from '@/services/message';

export const HETERO_MESSAGE_WRITE_BATCH_IDLE_MS = 5_000;
export const HETERO_MESSAGE_WRITE_BATCH_MAX_OPS = 50;

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
  createMessage: typeof messageService.createMessage;
  updateMessage: typeof messageService.updateMessage;
  updateToolMessage: typeof messageService.updateToolMessage;
}) => {
  let operations: QueuedMessageWriteOperation[] = [];
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

  const runIndividual = async (operation: QueuedMessageWriteOperation) => {
    if (operation.type === 'createMessage') {
      await deps.createMessage(operation.message);
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

  const flush = async (_reason: string) => {
    clearIdleTimer();
    flushChain = flushChain.then(async () => {
      while (operations.length > 0) {
        const batch = operations;
        operations = [];
        await runBatch(batch);
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
