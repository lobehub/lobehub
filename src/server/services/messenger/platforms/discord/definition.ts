import type { MessengerPlatformDefinition } from '../types';
import { MessengerDiscordBinder } from './binder';

export const discord: MessengerPlatformDefinition = {
  createBinder: () => new MessengerDiscordBinder(),
  id: 'discord',
  name: 'Discord',
};
