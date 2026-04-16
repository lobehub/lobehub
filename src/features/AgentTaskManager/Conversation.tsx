'use client';

import { type ConversationContext } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import debug from 'debug';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch } from 'react-router-dom';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { TopicTrigger } from '@/const/topic';
import { actionMap } from '@/features/ChatInput/ActionBar/config';
import { ActionBarContext } from '@/features/ChatInput/ActionBar/context';
import {
  COMPACT_ACTION_BAR_CONTEXT,
  COMPACT_ACTION_BAR_STYLE,
  COMPACT_SEND_BUTTON_PROPS,
} from '@/features/ChatInput/compactPreset';
import { ChatInput, ChatList, ConversationProvider } from '@/features/Conversation';
import { type ConversationHooks } from '@/features/Conversation/types';
import CopilotModelSelect from '@/features/PageEditor/Copilot/CopilotModelSelect';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useTaskChatStore } from '@/store/taskChat';

import Toolbar from './Toolbar';

const log = debug('lobe-render:agent-task-manager:Conversation');

const Search = actionMap['search'];

const EMPTY_LEFT_ACTIONS: [] = [];

const HOOKS: ConversationHooks = {
  onTopicCreated: (topicId: string) => useTaskChatStore.getState().onTopicCreated(topicId),
};

const Welcome = memo(() => {
  const { t } = useTranslation('topic');
  return (
    <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
      <Text style={{ fontSize: 15 }} type={'secondary'}>
        {t('taskManager.welcome')}
      </Text>
    </Flexbox>
  );
});

Welcome.displayName = 'Welcome';

const Conversation = memo(() => {
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const taskTopicId = useTaskChatStore((s) => s.activeTopicId);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(activeAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(activeAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  // Reset task topic when the route agent changes so a stale topicId from
  // the previous agent does not leak into this agent's messageMapKey.
  useEffect(() => {
    useTaskChatStore.getState().switchTopic(null);
  }, [activeAgentId]);

  const detailMatch = useMatch('/agent/:aid/tasks/:taskId');
  const isListRoute = !!useMatch('/agent/:aid/tasks');
  const viewedTaskId = detailMatch?.params.taskId;

  const context = useMemo<ConversationContext>(
    () => ({
      agentId: activeAgentId,
      isolatedTopic: true,
      scope: 'main',
      topicId: taskTopicId,
      topicTrigger: TopicTrigger.TaskManager,
      viewedTask: viewedTaskId
        ? { taskId: viewedTaskId, type: 'detail' }
        : isListRoute
          ? { type: 'list' }
          : undefined,
    }),
    [activeAgentId, taskTopicId, viewedTaskId, isListRoute],
  );

  const chatKey = messageMapKey(context);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  log('contextKey %s: %o', chatKey, messages);

  const operationState = useOperationState(context);

  const leftContent = useMemo(
    () => (
      <ActionBarContext value={COMPACT_ACTION_BAR_CONTEXT}>
        <Flexbox horizontal align={'center'} gap={2}>
          <Search />
        </Flexbox>
      </ActionBarContext>
    ),
    [],
  );

  const modelSelector = useMemo(() => <CopilotModelSelect />, []);

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      hooks={HOOKS}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(msgs, ctx) => {
        replaceMessages(msgs, { context: ctx });
      }}
    >
      <DragUploadZone style={{ flex: 1, height: '100%' }} onUploadFiles={handleUploadFiles}>
        <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
          <Toolbar />
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <ChatList welcome={<Welcome />} />
          </Flexbox>
          <ChatInput
            actionBarStyle={COMPACT_ACTION_BAR_STYLE}
            allowExpand={false}
            leftActions={EMPTY_LEFT_ACTIONS}
            leftContent={leftContent}
            sendAreaPrefix={modelSelector}
            sendButtonProps={COMPACT_SEND_BUTTON_PROPS}
            showRuntimeConfig={false}
          />
        </Flexbox>
      </DragUploadZone>
    </ConversationProvider>
  );
});

Conversation.displayName = 'Conversation';

export default Conversation;
