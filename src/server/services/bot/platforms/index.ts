import type { PlatformBotClass } from '../types';
import { Discord } from './discord';
import { Lark } from './lark';
import { Telegram } from './telegram';

export const platformBotRegistry: Record<string, PlatformBotClass> = {
  discord: Discord,
  feishu: Lark,
  lark: Lark,
  telegram: Telegram,
};
