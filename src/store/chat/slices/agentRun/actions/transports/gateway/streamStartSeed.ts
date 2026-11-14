import type { StreamStartData } from '@lobechat/agent-gateway-client';
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
  if (
    parent &&
    parent.id === seed.parentId &&
    !dbMessageSelectors.getDbMessageById(parent.id)(get())
  ) {
    get().internal_dispatchMessage(
      {
        createdAt: seedCreatedAt(get, parent.createdAt, parent.parentId),
        id: parent.id,
        type: 'createMessage',
        value: {
          ...shared,
          content: parent.content,
          metadata: parent.metadata ?? undefined,
          parentId: parent.parentId ?? undefined,
          role: 'user',
        },
      },
      dispatchContext,
    );
  }

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
