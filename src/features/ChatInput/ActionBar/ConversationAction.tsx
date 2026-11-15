'use client';

import { Phone } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { topicService } from '@/services/topic';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { ChatInputAction } from './components/ChatInputAction';

const VoiceCall = lazy(() =>
  import('@/features/Conversation/VoiceCall').then((module) => ({ default: module.VoiceCall })),
);

/** The settings/profile shell should not load the call SDK or its media UI. */
const ExistingConversation = () => (
  <Suspense fallback={null}>
    <VoiceCall />
  </Suspense>
);

const NewConversation = () => {
  const agentId = useAgentId();
  const { canUseResource } = useChatInputResourceAccess();
  const navigate = useNavigate();
  const { t } = useTranslation('chat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <ChatInputAction
        aria-label={t('voiceCall.start')}
        disabled={!agentId || !canUseResource || busy}
        icon={Phone}
        title={t('voiceCall.start')}
        onClick={() => {
          const settings = settingsSelectors.currentSettings(useUserStore.getState());
          if (
            !settings.general?.conversation?.enabled ||
            !settings.keyVaults?.livekit ||
            !settings.general.conversation.tts.model
          ) {
            navigate('/settings/conversation');
            return;
          }
          setBusy(true);
          setError(false);
          void topicService
            .createTopic({ sessionId: agentId, title: t('voiceCall.start') })
            .then((topicId) => navigate(`/agent/${agentId}/${topicId}?conversation=start`))
            .catch(() => setError(true))
            .finally(() => setBusy(false));
        }}
      />
      {error && <span role="alert">{t('voiceCall.error')}</span>}
    </>
  );
};

export const ConversationAction = () => {
  const { pathname } = useLocation();
  return pathname === '/' || !pathname.includes('/agent/') ? (
    <NewConversation />
  ) : (
    <ExistingConversation />
  );
};
