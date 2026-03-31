import type { PlatformDefinition } from '../types';
import { DiscordClientFactory } from './client';
import { schema } from './schema';

export const discord: PlatformDefinition = {
  id: 'discord',
  name: 'Discord',
  connectionMode: 'persistent',
  description: 'Connect a Discord bot',
  documentation: {
    portalUrl: 'https://discord.com/developers/applications',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/discord',
  },
  schema,
  clientFactory: new DiscordClientFactory(),
};
