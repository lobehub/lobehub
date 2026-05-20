'use client';

import { isChatGroupSessionId } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { actionMap } from '@/features/ChatInput/ActionBar/config';
import { ActionBarContext } from '@/features/ChatInput/ActionBar/context';
import {
  COMPACT_ACTION_BAR_CONTEXT,
  COMPACT_ACTION_BAR_STYLE,
  COMPACT_SEND_BUTTON_PROPS,
} from '@/features/ChatInput/compactPreset';
import {
  ChatInput,
  ChatList,
  conversationSelectors,
  useConversationStore,
} from '@/features/Conversation';
import CopilotModelSelect from '@/features/PageEditor/Copilot/CopilotModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import AgentSelectorAction from './AgentSelectorAction';
import { useTaskAgentSelection } from './TaskAgentProvider';
import Toolbar from './Toolbar';

const Search = actionMap['search'];

const EMPTY_LEFT_ACTIONS: [] = [];

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
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  const currentAgentId = useConversationStore(conversationSelectors.agentId);
  const selectTaskAgent = useTaskAgentSelection();

  useFetchAgentConfig(true, currentAgentId);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(currentAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(currentAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  const handleAgentChange = useCallback(
    (id: string) => {
      if (!id || id === currentAgentId || isChatGroupSessionId(id)) return;
      selectTaskAgent(id);
    },
    [currentAgentId, selectTaskAgent],
  );

  const leftContent = useMemo(
    () => (
      <ActionBarContext value={COMPACT_ACTION_BAR_CONTEXT}>
        <Flexbox horizontal align={'center'} gap={2}>
          <AgentSelectorAction onAgentChange={handleAgentChange} />
          <Search />
        </Flexbox>
      </ActionBarContext>
    ),
    [handleAgentChange],
  );

  const modelSelector = useMemo(() => <CopilotModelSelect />, []);

  return (
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
  );
});

Conversation.displayName = 'Conversation';

export default Conversation;
