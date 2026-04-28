'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type ConversationContext } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import debug from 'debug';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch } from 'react-router-dom';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
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
import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useTaskChatStore } from '@/store/taskChat';

import AgentSelectorAction from './AgentSelectorAction';
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
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.taskAgent);

  const taskAgentId = useAgentStore(builtinAgentSelectors.taskAgentId);
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  const selectedAgentId = useTaskChatStore((s) => s.selectedAgentId);
  const taskTopicId = useTaskChatStore((s) => s.activeTopicId);
  const switchAgent = useTaskChatStore((s) => s.switchAgent);

  const effectiveAgentId = selectedAgentId || taskAgentId;
  const conversationAgentId = effectiveAgentId || '';

  useEffect(() => {
    if (!taskAgentId || selectedAgentId) return;
    switchAgent(taskAgentId);
  }, [selectedAgentId, switchAgent, taskAgentId]);

  useFetchAgentConfig(true, conversationAgentId);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(conversationAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(conversationAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  const detailMatch = useMatch('/task/:taskId');
  const viewedTaskId = detailMatch?.params.taskId;

  const context = useMemo<ConversationContext>(
    () => ({
      agentId: conversationAgentId,
      isolatedTopic: true,
      scope: 'task',
      topicId: taskTopicId,
      topicTrigger: TopicTrigger.TaskManager,
      viewedTask: viewedTaskId ? { taskId: viewedTaskId, type: 'detail' } : { type: 'list' },
    }),
    [conversationAgentId, taskTopicId, viewedTaskId],
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
          <AgentSelectorAction onAgentChange={switchAgent} />
          <Search />
        </Flexbox>
      </ActionBarContext>
    ),
    [switchAgent],
  );

  const modelSelector = useMemo(() => <CopilotModelSelect />, []);

  const hasAgent = !!effectiveAgentId;

  if (!hasAgent) return <Loading debugId="AgentTaskManager" />;

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
