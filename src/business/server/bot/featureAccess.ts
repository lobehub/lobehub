/**
 * Feature-scoped capabilities that can be gated independently of the
 * platform itself. `messageMonitoring` covers passive channel listening
 * (e.g. watch-keyword wakes on ordinary, non-addressed channel messages).
 */
export type BotGatedFeature = 'messageMonitoring';

export interface BotFeatureAccessParams {
  action?: 'manage' | 'runtime';
  applicationId?: string;
  /** When set, checks access to a specific feature instead of the platform as a whole. */
  feature?: BotGatedFeature;
  platform: string;
  userId: string;
  workspaceId?: string;
}

export interface BotPlatformAccessMeta {
  allowed?: boolean;
  blockedMessage?: string;
  /** Per-feature access flags (platform-level `allowed` stays authoritative for the channel itself). */
  features?: Partial<Record<BotGatedFeature, { allowed: boolean }>>;
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

export async function withBotPlatformAccessMeta<T extends { id: string }>(
  platform: T,
  _params: { userId: string; workspaceId?: string },
): Promise<T & { access?: BotPlatformAccessMeta }> {
  return platform;
}
