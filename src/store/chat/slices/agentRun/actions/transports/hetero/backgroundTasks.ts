import type { HeteroBackgroundTask } from '@lobechat/heterogeneous-agents';

import type { MessageQueryContext } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

import type { createMessageWriteBatcher } from './messageWriteBatcher';

type MessageWriteBatcher = ReturnType<typeof createMessageWriteBatcher>;

/**
 * Stops one background task of a run hosted in this window. Resolves once the
 * agent accepted the request; the task only counts as stopped when its
 * `stopped` notification lands on the tool message.
 */
export type LocalBackgroundTaskStopper = (taskId: string) => Promise<void>;

const localStoppers = new Map<string, LocalBackgroundTaskStopper>();

/**
 * Register how to stop the background tasks of a local run, for as long as
 * its session lives. Only runtimes that can stop a single task register:
 * Claude Code, whose input (SDK stream or CLI stdin) stays open for the run.
 *
 * @returns Unregister; a no-op once a newer registration took the operation.
 */
export const registerLocalBackgroundTaskStopper = (
  operationId: string,
  stop: LocalBackgroundTaskStopper,
): (() => void) => {
  localStoppers.set(operationId, stop);
  return () => {
    if (localStoppers.get(operationId) === stop) localStoppers.delete(operationId);
  };
};

export const getLocalBackgroundTaskStopper = (
  operationId: string,
): LocalBackgroundTaskStopper | undefined => localStoppers.get(operationId);

interface WriteBackgroundTaskParams {
  messageWriteCtx?: MessageQueryContext;
  operationId: string;
  task: HeteroBackgroundTask;
  toolMessageId: string;
}

/**
 * Store a background task snapshot on its tool message, durable and live.
 * Only the `backgroundTask` key is written, so the tool's own result state
 * stays; the operation id goes with it so the sidebar can route a stop and
 * tell whether the run is still alive.
 */
export const writeBackgroundTaskSnapshot = (
  get: () => Pick<ChatStore, 'internal_dispatchMessage'>,
  batcher: Pick<MessageWriteBatcher, 'enqueueToolMessageUpdate'>,
  { messageWriteCtx, operationId, task, toolMessageId }: WriteBackgroundTaskParams,
): void => {
  const backgroundTask = { ...task, operationId };
  batcher.enqueueToolMessageUpdate(
    toolMessageId,
    { pluginState: { backgroundTask } },
    messageWriteCtx,
    (err) => console.error('[HeterogeneousAgent] Failed to persist background task:', err),
  );
  get().internal_dispatchMessage(
    { id: toolMessageId, key: 'backgroundTask', type: 'updatePluginState', value: backgroundTask },
    { operationId },
  );
};
