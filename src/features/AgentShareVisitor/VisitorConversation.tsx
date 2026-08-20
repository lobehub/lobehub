'use client';

import type { SharedAgentData } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import ReadOnlyConversationArea from './ReadOnlyConversationArea';

/**
 * The visitor-facing conversation column: mounts the lean read-only message
 * surface after hand-seeding the stores, mirroring the popup quick-chat pattern.
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

  // The message surface reads the active ids on first render — mounting it before
  // the seed lands would fetch against a stale topic left by the main app.
  if (!seeded) return null;

  return (
    <>
      <ReadOnlyConversationArea agentId={agentId} agentShareId={shareId} />
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
