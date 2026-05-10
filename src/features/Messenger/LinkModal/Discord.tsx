'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PlatformAvatar } from '../constants';

interface DiscordLinkBodyProps {
  appId?: string;
  /** Brand-name label (e.g. `"Discord"`) sourced from the registry. */
  name: string;
}

const DiscordLinkBody = memo<DiscordLinkBodyProps>(({ appId, name }) => {
  const { t } = useTranslation('messenger');

  // Route Discord installs through the LobeHub install endpoint so the OAuth
  // redirect lands at our callback — we read `guild_id` straight off the
  // redirect (Discord puts it in the URL for `scope=bot` flows) and fetch
  // guild metadata via the bot token, so no `client_secret` is needed.
  // `appId` gating still surfaces "not configured" copy when no bot is
  // registered at all.
  if (!appId) {
    return (
      <>
        <Icon icon={LinkIcon} size={36} />
        <Text strong>{t('messenger.linkModal.continueIn', { platform: name })}</Text>
        <Text type="warning">{t('messenger.discord.connectModal.notConfigured')}</Text>
      </>
    );
  }

  return (
    <>
      <PlatformAvatar platform="discord" size={64} />
      <Flexbox align="center" gap={6}>
        <Text strong style={{ fontSize: 18 }}>
          {t('messenger.discord.connectModal.title')}
        </Text>
        <Text style={{ textAlign: 'center' }} type="secondary">
          {t('messenger.discord.connectModal.description')}
        </Text>
      </Flexbox>
      <Button
        block
        href="/api/agent/messenger/discord/install"
        size="large"
        target="_blank"
        type="primary"
      >
        {t('messenger.discord.connectModal.inviteButton')}
      </Button>
    </>
  );
});

DiscordLinkBody.displayName = 'MessengerDiscordLinkBody';

export default DiscordLinkBody;
