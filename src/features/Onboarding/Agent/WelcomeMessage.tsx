import { Markdown } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatItem } from '@/features/Conversation/ChatItem';
import { useAgentMeta } from '@/features/Conversation/hooks';

const WELCOME_MESSAGE_ID = '__onboarding_welcome_message__';

const WelcomeMessage = memo(() => {
  const { t } = useTranslation('onboarding');
  const avatar = useAgentMeta();

  return (
    <ChatItem
      showTitle
      avatar={avatar}
      id={WELCOME_MESSAGE_ID}
      message={t('agent.welcome')}
      placement="left"
    >
      <Markdown variant="chat">{t('agent.welcome')}</Markdown>
    </ChatItem>
  );
});

WelcomeMessage.displayName = 'OnboardingWelcomeMessage';

export default WelcomeMessage;
