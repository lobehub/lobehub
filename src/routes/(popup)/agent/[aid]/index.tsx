'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { memo, useLayoutEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { WelcomeExtraProvider } from '@/features/AgentHome/WelcomeExtraContext';
import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import Conversation from '@/routes/(main)/agent/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import QuickChatAgentSwitcher from './QuickChatAgentSwitcher';

const PopupAgentQuickPage = memo(() => {
  const { aid } = useParams<{ aid: string }>();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  // The inbox slug is not a real agent id. Resolve it through
  // `builtinAgentIdMap` so `activeAgentId` points at the actual entity in
  // `agentMap` and `isAgentConfigLoading` can flip to false.
  const isInboxSlug = aid === INBOX_SESSION_ID;
  const effectiveAgentId = isInboxSlug ? inboxAgentId : aid;

  // For non-inbox agents fetch the config explicitly. The inbox config is
  // seeded by `useInitBuiltinAgent('inbox')` in StoreInitialization.
  useInitAgentConfig(isInboxSlug ? undefined : aid);

  useLayoutEffect(() => {
    if (!effectiveAgentId) return;
    useAgentStore.setState({ activeAgentId: effectiveAgentId }, false, 'PopupAgentQuickPage/sync');
    useChatStore.setState(
      {
        activeAgentId: effectiveAgentId,
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: undefined,
      },
      false,
      'PopupAgentQuickPage/sync',
    );
  }, [effectiveAgentId]);

  useFetchTopics();

  const welcomeExtra = useMemo(() => ({ extra: <QuickChatAgentSwitcher /> }), []);

  if (!effectiveAgentId) return <Loading debugId="PopupAgentQuickPage" />;

  return (
    <WelcomeExtraProvider value={welcomeExtra}>
      <Conversation />
    </WelcomeExtraProvider>
  );
});

PopupAgentQuickPage.displayName = 'PopupAgentQuickPage';

export default PopupAgentQuickPage;
