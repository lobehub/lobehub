import type { MessengerPlatformDefinition } from '../types';
import { MessengerTelegramBinder } from './binder';

export const telegram: MessengerPlatformDefinition = {
  createBinder: () => new MessengerTelegramBinder(),
  id: 'telegram',
  name: 'Telegram',
};
