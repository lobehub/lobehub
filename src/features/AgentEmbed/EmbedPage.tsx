'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { MessageSquareOff } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AgentEmbedChat, { AGENT_EMBED_CHAT_SUPPORTED } from '@/business/client/AgentEmbedChat';

import { getEmbedHostBridge } from './hostBridge';

/**
 * `/embed/agent/:slugOrId` — a shared Agent's conversation, trimmed to fit a
 * host website's panel. Who may frame it is decided server-side
 * (`frame-ancestors` from the share's allowlist); this page only talks to the
 * host that framed it.
 */
const AgentEmbedPage = memo(() => {
  const { t } = useTranslation('agent');
  const { slugOrId = '' } = useParams<{ slugOrId: string }>();
  const bridge = getEmbedHostBridge();

  if (!AGENT_EMBED_CHAT_SUPPORTED) {
    return (
      <Center height={'100dvh'} padding={24} width={'100%'}>
        <Empty
          description={t('share.embed.unavailable.desc')}
          icon={MessageSquareOff}
          title={t('share.embed.unavailable.title')}
        />
      </Center>
    );
  }

  return (
    <Flexbox height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
      <AgentEmbedChat
        framed={bridge.framed}
        slugOrId={slugOrId}
        onClose={() => bridge.emit({ type: 'close' })}
        onMessageSent={(topicId) => bridge.emit({ topicId, type: 'messageSent' })}
        onTopicCreated={(topicId) => bridge.emit({ topicId, type: 'topicCreated' })}
      />
    </Flexbox>
  );
});

AgentEmbedPage.displayName = 'AgentEmbedPage';

export default AgentEmbedPage;
