import { type UIChatMessage } from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';

/**
 * Thread-scoped in-memory dispatcher for a single subagent run. The
 * caller binds it to a per-spawn sub-operation whose
 * `OperationContext.threadId` + `scope: 'thread'` cause
 * `internal_dispatchMessage` to route every create/update into the
 * Thread's `messagesMap` bucket through the SAME context-resolution
 * path the main agent uses — no special-cased threadId override on the
 * dispatch boundary.
 *
 * Subagent streaming mirrors the main agent's gateway-handler flow:
 * DB writes are authoritative (see `persistSubagent*Chunk` +
 * `persistToolBatch`) and these dispatches feed the UI the same content
 * as tokens arrive, so the Thread view streams with the same cadence as
 * the main bubble. `fetchAndReplaceMessages` (main-topic scoped) never
 * refreshes the thread bucket, so without these dispatches the Thread
 * would only show stale DB state until the user re-navigates.
 */
export interface SubagentStoreDispatcher {
  /** Push a new message into the thread bucket (user / assistant / tool). */
  create: (msg: UIChatMessage) => void;
  /** Atomically replace pluginState and advance its optimistic watermark. */
  replacePluginState: (
    id: string,
    pluginState: Record<string, unknown>,
    metadata: NonNullable<UIChatMessage['metadata']>,
  ) => void;
  /** Update a message already in the thread bucket by id. */
  update: (id: string, value: Partial<UIChatMessage>) => void;
}

/**
 * Bind a subagent dispatcher to its sub-operation. Every row reaching
 * `create` was already written by `mutateMessageBatch`, so it enters the
 * transcript as server-known: a later read that omits it is authoritative.
 */
export const createSubagentStoreDispatcher = (
  get: () => ChatStore,
  dispatchContext: { operationId: string },
): SubagentStoreDispatcher => ({
  create(msg) {
    get().internal_dispatchMessage(
      { id: msg.id, type: 'createMessage', value: msg as any },
      dispatchContext,
      { creationOrigin: 'server' },
    );
  },
  replacePluginState(id, pluginState, metadata) {
    get().internal_dispatchMessage(
      { id, metadata, type: 'replaceMessagePluginState', value: pluginState },
      dispatchContext,
    );
  },
  update(id, value) {
    get().internal_dispatchMessage(
      { id, type: 'updateMessage', value: value as any },
      dispatchContext,
    );
  },
});
