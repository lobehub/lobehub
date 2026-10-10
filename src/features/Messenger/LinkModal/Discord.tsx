'use client';

import { Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OneClickBind from './OneClickBind';

interface DiscordLinkBodyProps {
  appId?: string;
  /** Brand-name label (e.g. `"Discord"`) sourced from the registry. */
  name: string;
}

const DiscordLinkBody = memo<DiscordLinkBodyProps>(({ appId, name }) => {
  const { t } = useTranslation('messenger');

  // `appId` gating still surfaces "not configured" copy when no bot is
  // registered at all, before minting a bind that could never complete.
  if (!appId) {
    return (
      <>
        <Icon icon={LinkIcon} size={36} />
        <Text strong>{t('messenger.linkModal.continueIn', { platform: name })}</Text>
        <Text type="warning">{t('messenger.discord.connectModal.notConfigured')}</Text>
      </>
    );
  }

  // Adding the bot to a server is an OAuth consent that also identifies the
  // person approving it, so the same round trip links their account.
  return <OneClickBind name={name} platform="discord" />;
});

DiscordLinkBody.displayName = 'MessengerDiscordLinkBody';

export default DiscordLinkBody;
