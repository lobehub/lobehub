import type { PlatformBotClass, PlatformDescriptor } from '../types';
import { Discord, discordDescriptor } from './discord';
import { feishuDescriptor, Lark, larkDescriptor } from './lark';
import { QQ, qqDescriptor } from './qq';
import { Telegram, telegramDescriptor } from './telegram';

export const platformBotRegistry: Record<string, PlatformBotClass> = {
  discord: Discord,
  feishu: Lark,
  lark: Lark,
  qq: QQ,
  telegram: Telegram,
};

export const platformDescriptors: Record<string, PlatformDescriptor> = {
  discord: discordDescriptor,
  feishu: feishuDescriptor,
  lark: larkDescriptor,
  qq: qqDescriptor,
  telegram: telegramDescriptor,
};

export function getPlatformDescriptor(platform: string): PlatformDescriptor | undefined {
  return platformDescriptors[platform];
}
