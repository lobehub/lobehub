import { channelDocUrl } from '@lobechat/const';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import type { PlatformDefinition } from '../types';
import { DiscordClientFactory } from './client';
import { DEFAULT_DISCORD_CONNECTION_MODE } from './const';
import { schema } from './schema';

export const discord: PlatformDefinition = {
  id: 'discord',
  name: 'Discord',
  connectionMode: DEFAULT_DISCORD_CONNECTION_MODE,
  description: 'Connect a Discord bot',
  documentation: {
    portalUrl: 'https://discord.com/developers/applications',
    setupGuideUrl: channelDocUrl('discord'),
  },
  schema,
  clientFactory: new DiscordClientFactory(),
  // Feishu/Lark-only document and Bitable tools are trimmed from the manifest.
  unsupportedMessageApis: PLATFORM_UNSUPPORTED_MESSAGE_APIS.discord,
};
