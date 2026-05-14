'use client';

import { memo } from 'react';

import type { MessengerPlatform } from '../../constants';
import DiscordBody from './Discord';
import type { ExistingLink, PeekedToken, PlatformMeta } from './shared';
import SlackBody from './Slack';
import TelegramBody from './Telegram';

interface BodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platform: MessengerPlatform;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
}

const Body = memo<BodyProps>(({ platform, ...rest }) => {
  switch (platform) {
    case 'slack': {
      return <SlackBody {...rest} />;
    }
    case 'discord': {
      return <DiscordBody {...rest} />;
    }
    case 'telegram': {
      return <TelegramBody {...rest} />;
    }
  }
});

Body.displayName = 'MessengerVerifyBody';

export default Body;
