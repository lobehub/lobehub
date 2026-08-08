'use client';

import { memo } from 'react';

import type { MessengerPlatform } from '../constants';
import DiscordDetail from './Discord';
import SlackDetail from './Slack';
import TelegramDetail from './Telegram';
import WechatDetail from './Wechat';

interface IntegrationDetailProps {
  access?: {
    allowed?: boolean;
    blockedMessage?: string;
    requiredPlan?: 'paid';
  };
  appId?: string;
  botUsername?: string;
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
  onBack: () => void;
  platform: MessengerPlatform;
}

const IntegrationDetail = memo<IntegrationDetailProps>(({ platform, ...rest }) => {
  switch (platform) {
    case 'slack': {
      return <SlackDetail {...rest} />;
    }
    case 'discord': {
      return <DiscordDetail {...rest} />;
    }
    case 'telegram': {
      return <TelegramDetail {...rest} />;
    }
    case 'wechat': {
      return <WechatDetail {...rest} />;
    }
  }
});

IntegrationDetail.displayName = 'MessengerIntegrationDetail';

export default IntegrationDetail;
