'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/index';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import SuggestQuestions from '@/features/SuggestQuestions';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const AgentBuilderWelcome = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useConversationStore(conversationSelectors.agentId);
  const agent = useAgentStore(agentByIdSelectors.getAgentConfigById(agentId));

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox
        gap={12}
        width={'100%'}
        style={{
          paddingBottom: 16,
        }}
      >
        <Avatar avatar={agent?.avatar || DEFAULT_INBOX_AVATAR} shape={'square'} size={78} />
        <Text fontSize={24} weight={'bold'}>
          {t('pageCopilot.title')}
        </Text>
        <SuggestQuestions count={3} mode="write" />
      </Flexbox>
    </>
  );
});

export default AgentBuilderWelcome;
