import { discord } from './discord';
import { MessengerPlatformRegistry } from './registry';
import { slack } from './slack';
import { telegram } from './telegram';

export { MessengerDiscordBinder } from './discord';
export { MessengerPlatformRegistry } from './registry';
export { MessengerSlackBinder, slackWebhookGate } from './slack';
export { MessengerTelegramBinder } from './telegram';
export type {
  MessengerPlatformDefinition,
  MessengerPlatformWebhookGate,
  MessengerWebhookContext,
  SerializedMessengerPlatformDefinition,
} from './types';

/**
 * Singleton registry — one per process. Each platform definition lives
 * alongside its binder + (optional) webhook gate, mirroring `bot/platforms/`.
 */
export const messengerPlatformRegistry = new MessengerPlatformRegistry()
  .register(slack)
  .register(telegram)
  .register(discord);
