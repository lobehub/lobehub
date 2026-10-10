'use client';

import { Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OneClickBind from './OneClickBind';

interface TelegramLinkBodyProps {
  botUsername?: string;
  /** Brand-name label (e.g. `"Telegram"`) sourced from the registry. */
  name: string;
}

const TelegramLinkBody = memo<TelegramLinkBodyProps>(({ botUsername, name }) => {
  const { t } = useTranslation('messenger');

  if (!botUsername) {
    return (
      <>
        <Icon icon={LinkIcon} size={36} />
        <Text strong>{t('messenger.linkModal.continueIn', { platform: name })}</Text>
        <Text type="warning">{t('messenger.linkModal.notConfigured')}</Text>
      </>
    );
  }

  // The deep link carries a one-time start token, so tapping Start in the bot
  // chat finishes the bind — no verify-im round trip.
  return <OneClickBind name={name} platform="telegram" />;
});

TelegramLinkBody.displayName = 'MessengerTelegramLinkBody';

export default TelegramLinkBody;
