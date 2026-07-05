import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

export interface BotFeatureAccessParams {
  applicationId?: string;
  platform: string;
  userId: string;
}

export interface BotPlatformAccessMeta {
  allowed?: boolean;
  blockedMessage?: string;
  requiredPlan?: 'paid';
}

export class BotFeatureAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotFeatureAccessError';
  }
}

export async function isBotFeatureAccessAllowed(_params: BotFeatureAccessParams): Promise<boolean> {
  return true;
}

export async function assertBotFeatureAccess(params: BotFeatureAccessParams): Promise<void> {
  if (await isBotFeatureAccessAllowed(params)) return;
  throw new BotFeatureAccessError(getBotFeatureBlockedMessage(params.platform));
}

export function getBotFeatureBlockedMessage(_platform: string): string {
  return 'This bot channel is not available for your current plan.';
}

export async function withBotPlatformAccessMeta<T extends SerializedPlatformDefinition>(
  platform: T,
  _params: { userId: string },
): Promise<T & { access?: BotPlatformAccessMeta }> {
  return platform;
}
