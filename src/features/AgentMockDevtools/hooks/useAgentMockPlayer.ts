import { executeMockStream, type MockCase } from '@lobechat/agent-mock';
import type { ConversationContext } from '@lobechat/types';
import { useCallback } from 'react';

import { topicSelectors } from '@/store/chat/selectors';
import { displayMessageSelectors } from '@/store/chat/slices/message/selectors';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useAgentMockStore } from '../store/agentMockStore';
import { createMockStoreInjector } from './createMockStoreInjector';

type MockStreamHandle = ReturnType<typeof executeMockStream>;

const playerController = {
  handle: null as MockStreamHandle | null,
  operationId: null as string | null,
};

interface StartArgs {
  /** Required — store dispatches messages keyed by agentId/topicId. */
  agentId: string;
  case: MockCase;
  topicId?: string;
}

const findRunningServerAssistantMessageId = (chatStore: ChatStore, args: StartArgs) => {
  const contextKey = messageMapKey({
    agentId: args.agentId,
    scope: 'main',
    topicId: args.topicId ?? null,
  });
  const messages = chatStore.dbMessagesMap[contextKey] ?? [];

  return [...messages].reverse().find((message) => {
    if (message.role !== 'assistant') return false;

    return (chatStore.operationsByMessage[message.id] ?? []).some((operationId) => {
      const operation = chatStore.operations[operationId];

      return operation?.status === 'running' && operation.type === 'execServerAgentRuntime';
    });
  })?.id;
};

const cancelRunningMessageRuntimeOperations = (chatStore: ChatStore, messageId: string) => {
  for (const operationId of chatStore.operationsByMessage[messageId] ?? []) {
    const operation = chatStore.operations[operationId];
    if (!operation || operation.status !== 'running') continue;
    if (!AI_RUNTIME_OPERATION_TYPES.includes(operation.type)) continue;

    chatStore.cancelOperation(operationId, 'Mock playback started');
  }
};

const clearLocalTopicRunningOperation = (chatStore: ChatStore, topicId: string | undefined) => {
  if (!topicId) return;

  const topic = topicSelectors.getTopicById(topicId)(chatStore);
  if (!topic?.metadata?.runningOperation) return;

  chatStore.internal_dispatchTopic(
    {
      id: topicId,
      type: 'updateTopic',
      value: {
        metadata: {
          ...topic.metadata,
          runningOperation: null,
        },
      },
    },
    'agentMock/clearRunningOperation',
  );
  chatStore.internal_updateTopicLoading(topicId, false);
};

export function useAgentMockPlayer() {
  const setPlayback = useAgentMockStore((s) => s.setPlayback);
  const speed = useAgentMockStore((s) => s.speed);

  const start = useCallback(
    (args: StartArgs) => {
      const chatStore = useChatStore.getState();

      playerController.handle?.stop();
      if (playerController.operationId) {
        chatStore.cancelOperation(playerController.operationId, 'Mock playback restarted');
        playerController.operationId = null;
      }

      chatStore.cancelOperations(
        {
          agentId: args.agentId,
          topicId: args.topicId ?? null,
          type: AI_RUNTIME_OPERATION_TYPES,
        },
        'Mock playback started',
      );
      clearLocalTopicRunningOperation(chatStore, args.topicId);

      const operationId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const context: ConversationContext = {
        agentId: args.agentId,
        scope: 'main',
        topicId: args.topicId,
      };
      const reusableAssistantMessageId = findRunningServerAssistantMessageId(chatStore, args);
      const assistantMessageId = reusableAssistantMessageId ?? `mock-msg-${operationId}`;

      if (reusableAssistantMessageId) {
        cancelRunningMessageRuntimeOperations(chatStore, reusableAssistantMessageId);
      }

      chatStore.startOperation({
        context: { ...context, messageId: assistantMessageId },
        operationId,
        type: 'execAgentRuntime',
      });
      playerController.operationId = operationId;

      if (reusableAssistantMessageId) {
        chatStore.internal_dispatchMessage(
          {
            id: assistantMessageId,
            type: 'updateMessage',
            value: { content: '', error: undefined },
          },
          { operationId },
        );
      } else {
        const parentId = displayMessageSelectors.lastDisplayMessageId(useChatStore.getState());
        chatStore.optimisticCreateTmpMessage(
          {
            agentId: args.agentId,
            content: '',
            parentId,
            role: 'assistant',
            topicId: args.topicId,
          },
          { operationId, tempMessageId: assistantMessageId },
        );
      }

      chatStore.associateMessageWithOperation(assistantMessageId, operationId);

      const handler = createMockStoreInjector(() => useChatStore.getState(), {
        assistantMessageId,
        context,
        operationId,
      });

      const handle = executeMockStream({
        case: args.case,
        onEvent: handler,
        operationId,
        speedMultiplier: speed,
      });

      handle.player.subscribe((state) => setPlayback(state));
      handle.start();
      playerController.handle = handle;
    },
    [setPlayback, speed],
  );

  const pause = useCallback(() => playerController.handle?.player.pause(), []);
  const resume = useCallback(() => playerController.handle?.player.resume(), []);
  const stop = useCallback(() => {
    playerController.handle?.stop();
    const operationId = playerController.operationId;
    if (operationId) {
      useChatStore.getState().cancelOperation(operationId, 'Mock playback stopped');
      playerController.operationId = null;
    }
    playerController.handle = null;
    setPlayback(null);
  }, [setPlayback]);
  const stepEvent = useCallback(() => playerController.handle?.player.stepNextEvent(), []);
  const stepStep = useCallback(() => playerController.handle?.player.stepNextStep(), []);
  const stepTool = useCallback(() => playerController.handle?.player.stepNextTool(), []);
  const setSpeed = useCallback(
    (s: Parameters<MockStreamHandle['player']['setSpeed']>[0]) =>
      playerController.handle?.player.setSpeed(s),
    [],
  );

  return { pause, resume, setSpeed, start, stepEvent, stepStep, stepTool, stop };
}
