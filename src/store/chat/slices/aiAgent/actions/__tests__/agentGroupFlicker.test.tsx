import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createStore,
  dataSelectors,
  Provider,
  useConversationStore,
} from '@/features/Conversation/store';
import StoreUpdater from '@/features/Conversation/StoreUpdater';
import { lambdaClient } from '@/libs/trpc/client';
import { agentRuntimeClient } from '@/services/agentRuntime';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

// Keep zustand mock as it's needed globally for store reset between tests
vi.mock('zustand/traditional');

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: { execGroupAgent: { mutate: vi.fn() } },
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

vi.mock('@/services/agentRuntime', () => ({
  agentRuntimeClient: { createStreamConnection: vi.fn() },
  StreamEvent: {},
}));

const IDS = {
  AGENT_ID: 'agt_flicker',
  GROUP_ID: 'grp_flicker',
  NEW_TOPIC_ID: 'tpc_new_from_server',
  OPERATION_ID: 'op_stream',
  ASSISTANT_MESSAGE_ID: 'msg_assistant',
  USER_MESSAGE_ID: 'msg_user',
} as const;

/**
 * One committed render frame of the conversation surface, recorded at paint
 * granularity (React useEffect = post-commit). `count` is how many messages the
 * UI would show; `showSkeleton` mirrors ChatList's blank gate exactly.
 */
interface Frame {
  count: number;
  messagesInit: boolean;
  showSkeleton: boolean;
  topicId: string | null | undefined;
}

let frames: Frame[] = [];

/**
 * Probe replicates ChatList's blank-decision (src/features/Conversation/ChatList/index.tsx):
 *   const isNewConversation = !context.topicId;
 *   if (!messagesInit && !isNewConversation) return <SkeletonList />;  // blank
 * It records every committed frame so the test can assert the just-sent message
 * never disappears (count drops to 0, or a skeleton replaces it) mid-flow.
 */
const Probe = () => {
  const messagesInit = useConversationStore(dataSelectors.messagesInit);
  const displayMessageIds = useConversationStore(dataSelectors.displayMessageIds);
  const topicId = useConversationStore((s) => s.context.topicId);

  const isNewConversation = !topicId;
  const showSkeleton = !messagesInit && !isNewConversation;

  useEffect(() => {
    frames.push({
      count: displayMessageIds.length,
      messagesInit,
      showSkeleton,
      topicId,
    });
  });

  return null;
};

/**
 * Mirrors ConversationArea: derives the group context from the live ChatStore
 * (topicId follows activeTopicId, exactly like useGroupContext), reads the raw
 * bucket from dbMessagesMap, and feeds an isolated ConversationStore — keyed by
 * contextKey so a topic switch remounts the store, just like ConversationProvider.
 */
const GroupAreaHarness = () => {
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const activeTopicId = useChatStore((s) => s.activeTopicId ?? null);
  const replaceMessages = useChatStore((s) => s.replaceMessages);

  const context = {
    agentId: activeAgentId!,
    groupId: activeGroupId!,
    isSupervisor: true,
    scope: 'group' as const,
    threadId: null,
    topicId: activeTopicId,
  };
  const chatKey = messageMapKey(context);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  return (
    <Provider
      key={chatKey}
      createStore={() =>
        createStore({ context, hooks: {}, initialMessages: messages, skipFetch: false })
      }
    >
      <StoreUpdater
        context={context}
        hasInitMessages={!!messages}
        messages={messages}
        onMessagesChange={(m, ctx) => replaceMessages(m, { context: ctx })}
      />
      <Probe />
    </Provider>
  );
};

const sendContext = () => ({
  agentId: IDS.AGENT_ID,
  groupId: IDS.GROUP_ID,
  threadId: null as string | null,
  topicId: null as string | null,
});

const mockNewTopicResponse = () => ({
  assistantMessageId: IDS.ASSISTANT_MESSAGE_ID,
  isCreateNewTopic: true,
  messages: [
    {
      content: 'Hello group!',
      createdAt: Date.now(),
      id: IDS.USER_MESSAGE_ID,
      role: 'user' as const,
      updatedAt: Date.now(),
    },
    {
      content: '',
      createdAt: Date.now(),
      id: IDS.ASSISTANT_MESSAGE_ID,
      role: 'assistant' as const,
      updatedAt: Date.now(),
    },
  ],
  operationId: IDS.OPERATION_ID,
  topicId: IDS.NEW_TOPIC_ID,
  topics: { items: [{ id: IDS.NEW_TOPIC_ID }], total: 1 },
  userMessageId: IDS.USER_MESSAGE_ID,
});

describe('group chat — initial message flicker', () => {
  beforeEach(() => {
    frames = [];
    vi.clearAllMocks();
    // Real store actions (NOT mocked) — drive the genuine optimistic→switch→replace flow.
    useChatStore.setState(
      {
        activeAgentId: IDS.AGENT_ID,
        activeGroupId: IDS.GROUP_ID,
        activeTopicId: undefined,
        dbMessagesMap: {},
        isCreatingMessage: false,
        messageOperationMap: {},
        messagesMap: {},
        operations: {},
      },
      false,
    );
    vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({ abort: vi.fn() } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sending the first message must never blank out across new-topic creation', async () => {
    vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
      mockNewTopicResponse() as any,
    );

    render(<GroupAreaHarness />);

    await act(async () => {
      await useChatStore.getState().sendGroupMessage({
        context: sendContext(),
        message: 'Hello group!',
      });
    });

    // Sanity: messages did show up at some point.
    const firstVisibleIdx = frames.findIndex((f) => f.count >= 1);
    expect(firstVisibleIdx).toBeGreaterThanOrEqual(0);

    // The flicker invariant: once the just-sent message is visible, no later
    // committed frame may drop it (count → 0) or replace it with a skeleton,
    // until the flow settles. A regression (switchTopic before replaceMessages)
    // produces exactly such a frame: the remounted store lands on the empty
    // new-topic bucket → showSkeleton true / count 0.
    const framesAfterVisible = frames.slice(firstVisibleIdx);
    const blankFrame = framesAfterVisible.find((f) => f.count === 0 || f.showSkeleton);

    expect(
      blankFrame,
      `Message disappeared mid-flow. Frame timeline: ${JSON.stringify(frames, null, 2)}`,
    ).toBeUndefined();

    // Final state: the two server messages live under the new topic.
    const lastFrame = frames.at(-1)!;
    expect(lastFrame.topicId).toBe(IDS.NEW_TOPIC_ID);
    expect(lastFrame.count).toBe(2);
    expect(lastFrame.showSkeleton).toBe(false);
  });
});
