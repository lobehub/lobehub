import type { MessengerPlatformDefinition } from '../types';
import { MessengerDiscordBinder } from './binder';
import { discordOAuthAdapter } from './oauth';

export const discord: MessengerPlatformDefinition = {
  // SystemBot Discord runs as a single platform-wide WS registered by
  // dc-center at `messenger:discord:singleton`; all users share it.
  connectionMode: 'websocket',
  createBinder: () => new MessengerDiscordBinder(),
  id: 'discord',
  name: 'Discord',
  oauth: discordOAuthAdapter,
};
