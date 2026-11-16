import type { StreamStartData, StreamStartParentMessage } from '@lobechat/agent-gateway-client';
import type { ConversationContext } from '@lobechat/types';

import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import type { OperationMetadata } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

/**
 * When a seeded row was created: the server's time when it ships one, never
 * before its parent. The list sorts by `createdAt`, so a client clock behind
 * the server's would otherwise file the reply above the message it answers.
 */
const seedCreatedAt = (
  get: () => ChatStore,
  serverTime: number | undefined,
  parentId: string | null | undefined,
): number => {
  const time = serverTime ?? Date.now();
  const parentCreatedAt = parentId
    ? dbMessageSelectors.getDbMessageById(parentId)(get())?.createdAt
    : undefined;
  const parentTime = parentCreatedAt === undefined ? NaN : new Date(parentCreatedAt).getTime();

  return Number.isFinite(parentTime) && time <= parentTime ? parentTime + 1 : time;
};

interface SeedFields {
  agentId?: string | null;
  groupId?: string;
  threadId?: string;
  topicId?: string;
}

const insertSteerRow = (
  get: () => ChatStore,
  steer: StreamStartParentMessage,
  shared: SeedFields,
  dispatchContext: { operationId: string },
): void => {
  if (dbMessageSelectors.getDbMessageById(steer.id)(get())) return;

  get().internal_dispatchMessage(
    {
      createdAt: seedCreatedAt(get, steer.createdAt, steer.parentId),
      id: steer.id,
      type: 'createMessage',
      value: {
        ...shared,
        agentId: shared.agentId ?? undefined,
        content: steer.content,
        metadata: steer.metadata ?? undefined,
        parentId: steer.parentId ?? undefined,
        role: 'user',
      },
    },
    dispatchContext,
  );
};

/**
 * Insert the steer user message a heterogeneous run just read from its live
 * session (`step_complete` with `phase: 'user_message'`). The server already
 * wrote it and the queue tray drops it now; without this it is missing from
 * the chat until the reply it opens starts streaming.
 */
export const insertSteerMessage = (
  get: () => ChatStore,
  steer: StreamStartParentMessage,
  context: ConversationContext,
  dispatchContext: { operationId: string },
): void =>
  insertSteerRow(
    get,
    steer,
    {
      // The server persists it under the executing agent, which can differ
      // from the conversation owner (an @-mentioned or sub-agent run).
      agentId: steer.agentId ?? context.agentId,
      groupId: context.groupId ?? undefined,
      threadId: context.threadId ?? undefined,
      topicId: context.topicId ?? undefined,
    },
    dispatchContext,
  );

/**
 * Insert the rows a seeded `stream_start` names into the local store, so the
 * step renders without a DB read. Newer servers ship the assistant seed; the
 * caller falls back to a refetch when there is none.
 *
 * - The step's assistant row: the `step_start` snapshot is resolved before it
 *   is created, and chunks dispatched to a missing id are dropped.
 * - A queued follow-up the server joined into the run (`parentMessage`): its
 *   user row is created after that snapshot too. Without it the message is
 *   gone from both the tray and the chat until the step ends.
 */
export const insertStreamStartSeeds = (
  get: () => ChatStore,
  data: StreamStartData,
  context: ConversationContext,
  dispatchContext: { operationId: string },
): void => {
  const { assistantMessage: seed, parentMessage: parent } = data;
  const shared = {
    agentId: seed.agentId ?? context.agentId,
    groupId: seed.groupId ?? undefined,
    threadId: seed.threadId ?? undefined,
    topicId: seed.topicId ?? context.topicId ?? undefined,
  };

  // Ahead of the reply, so the list keeps the turn's order.
  if (parent && parent.id === seed.parentId) insertSteerRow(get, parent, shared, dispatchContext);

  get().internal_dispatchMessage(
    {
      createdAt: seedCreatedAt(get, seed.createdAt, seed.parentId),
      id: seed.id,
      type: 'createMessage',
      value: {
        ...shared,
        content: '',
        model: seed.model ?? data.model,
        parentId: seed.parentId ?? undefined,
        provider: seed.provider ?? data.provider,
        role: 'assistant',
      },
    },
    dispatchContext,
  );
};

/**
 * Operation metadata a `stream_start` sets: the step is loading again, and a
 * heterogeneous run whose producer delivers queued follow-ups into the live
 * session (`liveSteer`, Claude Code) no longer holds its queue to the run end.
 */
export const streamStartOperationMetadata = (
  data: object | undefined,
): Partial<OperationMetadata> => ({
  visibleLoadingDone: false,
  ...(data && 'liveSteer' in data && data.liveSteer === true ? { liveSteer: true } : {}),
});
