import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

export interface BotFeatureAccessParams {
  action?: 'manage' | 'runtime';
  applicationId?: string;
  platform: string;
  userId: string;
  workspaceId?: string;
}

export interface BotPlatformAccessMeta {
  allowed?: boolean;
  blockedMessage?: string;
  requiredPlan?: 'paid';
  rolloutMode?: 'enforce' | 'notice';
}

export interface BotFeatureAccessState extends BotPlatformAccessMeta {
  allowed: boolean;
  notice?: {
    id: string;
  };
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

export async function getBotFeatureAccessState(
  _params: BotFeatureAccessParams,
): Promise<BotFeatureAccessState> {
  return { allowed: true };
}

export async function assertBotFeatureAccess(params: BotFeatureAccessParams): Promise<void> {
  if (await isBotFeatureAccessAllowed(params)) return;
  throw new BotFeatureAccessError(
    getBotFeatureBlockedMessage(params.platform, params.workspaceId ? 'workspace' : 'personal'),
  );
}

export function getBotFeatureBlockedMessage(
  _platform: string,
  _scope?: 'personal' | 'workspace',
): string {
  return 'This bot channel is not available for your current plan.';
}

export async function withBotPlatformAccessMeta<T extends SerializedPlatformDefinition>(
  platform: T,
  _params: { userId: string; workspaceId?: string },
): Promise<T & { access?: BotPlatformAccessMeta }> {
  return platform;
}
