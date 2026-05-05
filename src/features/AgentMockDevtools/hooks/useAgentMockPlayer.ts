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

interface PlaybackSession {
  args: StartArgs;
  assistantMessageId: string;
  parentMessageId: string | null;
  reuseAssistantMessage: boolean;
}

const playerController = {
  handle: null as MockStreamHandle | null,
  operationId: null as string | null,
  session: null as PlaybackSession | null,
  unsubscribe: null as (() => void) | null,
};

interface StartArgs {
  /** Required — store dispatches messages keyed by the active conversation target. */
  agentId: string;
  case: MockCase;
  threadId?: string | null;
  topicId?: string;
}

const findRunningServerAssistantMessageId = (chatStore: ChatStore, args: StartArgs) => {
  const contextKey = messageMapKey({
    agentId: args.agentId,
    scope: args.threadId ? 'thread' : 'main',
    threadId: args.threadId ?? null,
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

const getContextKey = (args: StartArgs) =>
  messageMapKey({
    agentId: args.agentId,
    scope: args.threadId ? 'thread' : 'main',
    threadId: args.threadId ?? null,
    topicId: args.topicId ?? null,
  });

const getMockToolMessagePrefix = (assistantMessageId: string) =>
  `mock-tool-msg-${assistantMessageId}-`;

const clearMockToolMessages = (
  chatStore: ChatStore,
  args: StartArgs,
  assistantMessageId: string,
  operationId: string,
) => {
  const messages = chatStore.dbMessagesMap[getContextKey(args)] ?? [];
  const prefix = getMockToolMessagePrefix(assistantMessageId);
  const toolMessageIds = messages
    .filter(
      (message) =>
        message.role === 'tool' &&
        message.parentId === assistantMessageId &&
        message.id.startsWith(prefix),
    )
    .map((message) => message.id);

  if (toolMessageIds.length === 0) return;

  chatStore.internal_dispatchMessage(
    {
      ids: toolMessageIds,
      type: 'deleteMessages',
    },
    { operationId },
  );
};

const resetAssistantProjection = (
  chatStore: ChatStore,
  session: PlaybackSession,
  operationId: string,
) => {
  clearMockToolMessages(chatStore, session.args, session.assistantMessageId, operationId);

  if (session.reuseAssistantMessage) {
    chatStore.internal_dispatchMessage(
      {
        id: session.assistantMessageId,
        type: 'updateMessage',
        value: {
          content: '',
          error: null as never,
          reasoning: { content: '' },
          tools: [],
        },
      },
      { operationId },
    );
  } else {
    chatStore.internal_dispatchMessage(
      {
        id: session.assistantMessageId,
        type: 'deleteMessage',
      },
      { operationId },
    );
    chatStore.internal_dispatchMessage(
      {
        id: session.assistantMessageId,
        type: 'createMessage',
        value: {
          agentId: session.args.agentId,
          content: '',
          parentId: session.parentMessageId ?? undefined,
          role: 'assistant',
          threadId: session.args.threadId ?? undefined,
          topicId: session.args.topicId,
        },
      },
      { operationId },
    );
  }

  chatStore.internal_toggleToolCallingStreaming(session.assistantMessageId, undefined);
};

export function useAgentMockPlayer() {
  const setPlayback = useAgentMockStore((s) => s.setPlayback);
  const speed = useAgentMockStore((s) => s.speed);

  const disposeCurrentPlayback = useCallback(
    (chatStore: ChatStore, reason: string, keepSession: boolean = false) => {
      playerController.unsubscribe?.();
      playerController.unsubscribe = null;

      playerController.handle?.stop();

      if (playerController.operationId) {
        chatStore.cancelOperation(playerController.operationId, reason);
        playerController.operationId = null;
      }

      playerController.handle = null;
      if (!keepSession) {
        playerController.session = null;
      }
    },
    [],
  );

  const createPlayback = useCallback(
    (
      args: StartArgs,
      sessionOverride?: Pick<
        PlaybackSession,
        'assistantMessageId' | 'parentMessageId' | 'reuseAssistantMessage'
      >,
    ) => {
      const chatStore = useChatStore.getState();

      playerController.unsubscribe?.();
      playerController.unsubscribe = null;

      clearLocalTopicRunningOperation(chatStore, args.topicId);

      const now = Date.now();
      const operationId = `mock-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const context: ConversationContext = {
        agentId: args.agentId,
        scope: args.threadId ? 'thread' : 'main',
        topicId: args.topicId,
        ...(args.threadId ? { threadId: args.threadId } : {}),
      };

      const reusableAssistantMessageId =
        sessionOverride?.assistantMessageId ?? findRunningServerAssistantMessageId(chatStore, args);
      const reuseAssistantMessage =
        sessionOverride?.reuseAssistantMessage ?? reusableAssistantMessageId != null;
      const assistantMessageId = reusableAssistantMessageId ?? `mock-msg-${operationId}`;
      const parentMessageId =
        sessionOverride?.parentMessageId ??
        (reuseAssistantMessage
          ? null
          : displayMessageSelectors.lastDisplayMessageId(useChatStore.getState())) ??
        null;

      if (!sessionOverride && reuseAssistantMessage) {
        cancelRunningMessageRuntimeOperations(chatStore, assistantMessageId);
      }

      chatStore.startOperation({
        context: { ...context, messageId: assistantMessageId },
        operationId,
        type: 'execAgentRuntime',
      });
      playerController.operationId = operationId;

      if (sessionOverride) {
        resetAssistantProjection(
          chatStore,
          {
            args,
            assistantMessageId,
            parentMessageId,
            reuseAssistantMessage,
          },
          operationId,
        );
      } else if (reuseAssistantMessage) {
        resetAssistantProjection(
          chatStore,
          {
            args,
            assistantMessageId,
            parentMessageId,
            reuseAssistantMessage: true,
          },
          operationId,
        );
      }

      if (!reuseAssistantMessage && !sessionOverride) {
        chatStore.optimisticCreateTmpMessage(
          {
            agentId: args.agentId,
            content: '',
            parentId: parentMessageId ?? undefined,
            role: 'assistant',
            threadId: args.threadId ?? undefined,
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

      playerController.handle = handle;
      playerController.session = {
        args,
        assistantMessageId,
        parentMessageId,
        reuseAssistantMessage,
      };
      playerController.unsubscribe = handle.player.subscribe((state) => setPlayback(state));
      setPlayback(handle.player.getState());

      return handle;
    },
    [setPlayback, speed],
  );

  const start = useCallback(
    (args: StartArgs) => {
      const chatStore = useChatStore.getState();

      disposeCurrentPlayback(chatStore, 'Mock playback restarted');

      chatStore.cancelOperations(
        {
          agentId: args.agentId,
          threadId: args.threadId ?? undefined,
          topicId: args.topicId ?? null,
          type: AI_RUNTIME_OPERATION_TYPES,
        },
        'Mock playback started',
      );
      const handle = createPlayback(args);
      handle.start();
      setPlayback(handle.player.getState());
    },
    [createPlayback, disposeCurrentPlayback, setPlayback],
  );

  const pause = useCallback(() => playerController.handle?.player.pause(), []);
  const resume = useCallback(() => playerController.handle?.player.resume(), []);
  const stop = useCallback(() => {
    disposeCurrentPlayback(useChatStore.getState(), 'Mock playback stopped');
    setPlayback(null);
  }, [disposeCurrentPlayback, setPlayback]);
  const stepEvent = useCallback(() => playerController.handle?.player.stepNextEvent(), []);
  const stepStep = useCallback(() => playerController.handle?.player.stepNextStep(), []);
  const stepTool = useCallback(() => playerController.handle?.player.stepNextTool(), []);
  const seekToEventIndex = useCallback(
    (idx: number) => {
      const handle = playerController.handle;
      const session = playerController.session;

      if (!handle || !session) return;

      const currentState = handle.player.getState();
      if (idx >= currentState.currentEventIndex) {
        handle.player.seekToEventIndex(idx);
        setPlayback(handle.player.getState());
        return;
      }

      const chatStore = useChatStore.getState();
      const shouldResumeRunning = currentState.status === 'running';
      const shouldPauseAtTarget =
        currentState.status === 'paused' || currentState.status === 'complete';

      disposeCurrentPlayback(chatStore, 'Mock playback rewound', true);
      chatStore.cancelOperations(
        {
          agentId: session.args.agentId,
          threadId: session.args.threadId ?? undefined,
          topicId: session.args.topicId ?? null,
          type: AI_RUNTIME_OPERATION_TYPES,
        },
        'Mock playback rewound',
      );

      const rebuiltHandle = createPlayback(session.args, {
        assistantMessageId: session.assistantMessageId,
        parentMessageId: session.parentMessageId,
        reuseAssistantMessage: session.reuseAssistantMessage,
      });

      rebuiltHandle.player.seekToEventIndex(idx);
      setPlayback(rebuiltHandle.player.getState());

      if (shouldResumeRunning) {
        rebuiltHandle.start();
        setPlayback(rebuiltHandle.player.getState());
        return;
      }

      if (shouldPauseAtTarget || idx > 0) {
        rebuiltHandle.start();
        rebuiltHandle.player.pause();
        setPlayback(rebuiltHandle.player.getState());
      }
    },
    [createPlayback, disposeCurrentPlayback, setPlayback],
  );
  const setSpeed = useCallback(
    (s: Parameters<MockStreamHandle['player']['setSpeed']>[0]) =>
      playerController.handle?.player.setSpeed(s),
    [],
  );

  return {
    pause,
    resume,
    seekToEventIndex,
    setSpeed,
    start,
    stepEvent,
    stepStep,
    stepTool,
    stop,
  };
}
