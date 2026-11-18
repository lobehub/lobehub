'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { MessageSquareOff } from 'lucide-react';
import { memo, useEffect } from 'react';
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
  // Started after mount: it seeds the host's theme into the theme provider,
  // which must not update while this page renders. The loader keeps repeating
  // `init` until the bridge answers, so a late start loses nothing.
  useEffect(() => {
    getEmbedHostBridge();
  }, []);

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
        framed={window.parent !== window}
        slugOrId={slugOrId}
        onClose={() => getEmbedHostBridge().emit({ type: 'close' })}
        onMessageSent={(topicId) => getEmbedHostBridge().emit({ topicId, type: 'messageSent' })}
        onTopicCreated={(topicId) => getEmbedHostBridge().emit({ topicId, type: 'topicCreated' })}
      />
    </Flexbox>
  );
});

AgentEmbedPage.displayName = 'AgentEmbedPage';

export default AgentEmbedPage;
