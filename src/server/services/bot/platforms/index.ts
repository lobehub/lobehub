import type { PlatformBotClass } from '../types';
import { Discord } from './discord';

export const platformBotRegistry: Record<string, PlatformBotClass> = {
  discord: Discord,
};
