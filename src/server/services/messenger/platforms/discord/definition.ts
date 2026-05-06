import type { MessengerPlatformDefinition } from '../types';
import { MessengerDiscordBinder } from './binder';
import { discordOAuthAdapter } from './oauth';

export const discord: MessengerPlatformDefinition = {
  createBinder: () => new MessengerDiscordBinder(),
  id: 'discord',
  name: 'Discord',
  oauth: discordOAuthAdapter,
};
