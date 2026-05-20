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
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/discord',
  },
  schema,
  clientFactory: new DiscordClientFactory(),
};
