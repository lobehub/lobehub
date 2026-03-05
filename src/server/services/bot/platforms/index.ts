import type { PlatformBotClass } from '../types';
import { Discord } from './discord';
import { Telegram } from './telegram';

export const platformBotRegistry: Record<string, PlatformBotClass> = {
  discord: Discord,
  telegram: Telegram,
};
