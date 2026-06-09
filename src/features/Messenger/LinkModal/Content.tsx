'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import type { MessengerPlatform } from '../constants';
import DiscordLinkBody from './Discord';
import SlackLinkBody from './Slack';
import TelegramLinkBody from './Telegram';

export interface LinkModalContentProps {
  appId?: string;
  botUsername?: string;
  name: string;
  platform: MessengerPlatform;
}

const LinkModalContent = memo<LinkModalContentProps>(({ appId, botUsername, name, platform }) => {
  const renderBody = () => {
    switch (platform) {
      case 'slack': {
        return <SlackLinkBody />;
      }
      case 'discord': {
        return <DiscordLinkBody appId={appId} name={name} />;
      }
      case 'telegram': {
        return <TelegramLinkBody botUsername={botUsername} name={name} />;
      }
    }
  };

  return (
    <Flexbox align={'center'} gap={20} style={{ paddingBlockEnd: 16, paddingBlockStart: 24 }}>
      {renderBody()}
    </Flexbox>
  );
});

LinkModalContent.displayName = 'MessengerLinkModalContent';

export default LinkModalContent;
