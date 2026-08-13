'use client';

import { Flexbox, Markdown, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { contextSelectors } from '@/features/Conversation/store';
import { useIsMobile } from '@/hooks/useIsMobile';
import { chatGroupProjectionSelectors, useChatGroupProjection } from '@/projection';
import SupervisorAvatar from '@/routes/(main)/group/features/GroupAvatar';
import { useAgentStore } from '@/store/agent';
import {
  agentProjectionSelectors,
  useCurrentAgentMeta,
  useCurrentAgentValue,
} from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import OpeningQuestions from './OpeningQuestions';
import ToolAuthAlert from './ToolAuthAlert';

const InboxWelcome = memo(() => {
  const { t } = useTranslation(['welcome', 'chat']);
  const mobile = useIsMobile();
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const fontSize = useUserStore(userGeneralSettingsSelectors.fontSize);
  const meta = useCurrentAgentMeta();
  const groupId = useConversationStore(contextSelectors.groupId);
  const groupMeta = useChatGroupProjection(
    chatGroupProjectionSelectors.getGroupMeta(groupId ?? ''),
  );

  // Use group config for opening message and questions
  const groupOpeningMessage = useChatGroupProjection(
    chatGroupProjectionSelectors.getGroupOpeningMessage(groupId ?? ''),
  );
  const groupOpeningQuestions = useChatGroupProjection(
    chatGroupProjectionSelectors.getGroupOpeningQuestions(groupId ?? ''),
    isEqual,
  );

  const agentSystemRoleMsg = t('agentDefaultMessageWithSystemRole', {
    name: meta.title || t('defaultAgent', { ns: 'chat' }),
    ns: 'chat',
  });

  // Get agent opening message and questions (always call hooks)
  const agentOpeningMessage = useCurrentAgentValue(agentProjectionSelectors.openingMessage);
  const agentOpeningQuestions = useCurrentAgentValue(agentProjectionSelectors.openingQuestions);

  // Prefer group opening message/questions over agent's
  const openingMessage = groupOpeningMessage || agentOpeningMessage;
  const openingQuestions =
    groupOpeningQuestions.length > 0 ? groupOpeningQuestions : agentOpeningQuestions;

  const message = useMemo(() => {
    if (openingMessage) return openingMessage;
    return agentSystemRoleMsg;
  }, [openingMessage, agentSystemRoleMsg]);

  const displayTitle = groupMeta.title;

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox
        gap={12}
        width={'100%'}
        style={{
          paddingBottom: 'max(10vh, 32px)',
        }}
      >
        <SupervisorAvatar size={78} />
        <Text fontSize={32} weight={'bold'}>
          {displayTitle}
        </Text>
        <Flexbox width={'min(100%, 640px)'}>
          <Markdown fontSize={fontSize} variant={'chat'}>
            {isInbox ? t('guide.defaultMessageWithoutCreate', { appName: 'Lobe AI' }) : message}
          </Markdown>
        </Flexbox>
        {openingQuestions.length > 0 && (
          <OpeningQuestions mobile={mobile} questions={openingQuestions} />
        )}
        <ToolAuthAlert />
      </Flexbox>
    </>
  );
});

export default InboxWelcome;
