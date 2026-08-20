'use client';

import type { SharedAgentData } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConversationArea from '@/routes/(main)/agent/features/Conversation/ConversationArea';
import { type MainChatInputProps } from '@/routes/(main)/agent/features/Conversation/MainChatInput';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

// Sending goes live with the share execution chain (C4). The model picker /
// "+" menu are owner-facing and the voice-message action sends through a path
// that ignores `disableSend`, so both action groups stay hidden for visitors.
const visitorChatInputProps: MainChatInputProps = {
  disableSend: true,
  leftActions: [],
  rightActions: [],
};

/**
 * The visitor-facing conversation column: mounts the standard ConversationArea
 * after hand-seeding the stores, mirroring the popup quick-chat pattern.
 */
const VisitorConversation = memo<{ data: SharedAgentData }>(({ data }) => {
  const { t } = useTranslation('agent');
  const { agentId, agentMeta, shareId } = data;
  const [seeded, setSeeded] = useState(false);

  useLayoutEffect(() => {
    // Visitors cannot call the owner-scoped agent-config API, so seed a
    // minimal `agentMap` entry from the share metadata by hand — mere
    // presence is what flips `isAgentConfigLoading*` off for the welcome
    // header and chat input skeletons. Merged via the store's dispatcher
    // (the `/share/t` precedent) so nulls never clobber existing fields.
    useAgentStore.getState().internal_dispatchAgentMap(agentId, {
      avatar: agentMeta.avatar ?? undefined,
      backgroundColor: agentMeta.backgroundColor ?? undefined,
      name: agentMeta.name ?? undefined,
      title: agentMeta.title ?? undefined,
    });
    useAgentStore.setState({ activeAgentId: agentId }, false, 'AgentShareVisitor/seedSharedAgent');
    useChatStore.setState(
      {
        activeAgentId: agentId,
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: undefined,
      },
      false,
      'AgentShareVisitor/sync',
    );
    setSeeded(true);
  }, [agentId, agentMeta]);

  // ConversationArea reads the active ids on first render — mounting it before
  // the seed lands would fetch against a stale topic left by the main app.
  if (!seeded) return null;

  return (
    <>
      <ConversationArea agentShareId={shareId} mainChatInputProps={visitorChatInputProps} />
      <Flexbox align={'center'} paddingBlock={4}>
        <span style={{ color: cssVar.colorTextDescription, fontSize: 12, textAlign: 'center' }}>
          {t('share.visitor.sendDisabled')}
        </span>
      </Flexbox>
    </>
  );
});

VisitorConversation.displayName = 'ShareVisitorConversation';

export default VisitorConversation;
