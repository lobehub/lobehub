import { createHash } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import {
  platformTrialConfig,
  trialAbuseBlocklist,
  usageLogs,
  userTrials,
  userWallets,
  walletTransactions,
} from '../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../type';

export const fingerprintPhone = (phone: string): string =>
  createHash('sha256').update(`phone:${phone.trim()}`).digest('hex');

export const fingerprintEmail = (email: string): string =>
  createHash('sha256').update(`email:${email.trim().toLowerCase()}`).digest('hex');

export class AicoBillingModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  // ─── FX / wallets ──────────────────────────────────────────────────

  getOrCreateUserWallet = async (userId: string) => {
    const existing = await this.db.query.userWallets.findFirst({
      where: eq(userWallets.userId, userId),
    });
    if (existing) return existing;

    const [created] = await this.db
      .insert(userWallets)
      .values({ userId })
      .onConflictDoNothing({ target: userWallets.userId })
      .returning();
    if (created) return created;

    return (await this.db.query.userWallets.findFirst({
      where: eq(userWallets.userId, userId),
    }))!;
  };

  getUserWallet = async (userId: string) => {
    return this.db.query.userWallets.findFirst({
      where: eq(userWallets.userId, userId),
    });
  };

  mockTopupUser = async (params: {
    amountToman: number;
    amountUsd: number;
    createdByUserId: string;
    fxRate: number;
    gatewayRefId?: string;
    userId: string;
  }) => {
    if (params.amountToman <= 0) throw new Error('amountToman must be positive');
    if (params.amountUsd <= 0) throw new Error('amountUsd must be positive');

    return this.db.transaction(async (tx) => {
      await tx.insert(userWallets).values({ userId: params.userId }).onConflictDoNothing({
        target: userWallets.userId,
      });

      const [txRow] = await tx
        .insert(walletTransactions)
        .values({
          amountToman: params.amountToman,
          amountUsd: params.amountUsd,
          createdByUserId: params.createdByUserId,
          description: 'Mock topup',
          fxRate: params.fxRate,
          gatewayRefId: params.gatewayRefId ?? `mock_${Date.now()}`,
          type: 'topup',
          userId: params.userId,
        })
        .returning();

      const [wallet] = await tx
        .update(userWallets)
        .set({
          balanceToman: sql`${userWallets.balanceToman} + ${params.amountToman}`,
          balanceUsd: sql`${userWallets.balanceUsd} + ${params.amountUsd}`,
          isActive: true,
        })
        .where(eq(userWallets.userId, params.userId))
        .returning();

      return { transaction: txRow, wallet };
    });
  };

  updateUserOpenRouterKey = async (params: {
    encryptedKey: string;
    keyId: string;
    userId: string;
  }) => {
    await this.getOrCreateUserWallet(params.userId);
    const [row] = await this.db
      .update(userWallets)
      .set({
        openrouterKeyHash: params.encryptedKey,
        openrouterKeyId: params.keyId,
      })
      .where(eq(userWallets.userId, params.userId))
      .returning();
    return row;
  };

  listUserTransactions = async (userId: string, limit = 50) => {
    return this.db.query.walletTransactions.findMany({
      where: eq(walletTransactions.userId, userId),
      orderBy: [desc(walletTransactions.createdAt)],
      limit,
    });
  };

  listUserUsage = async (userId: string, limit = 50) => {
    return this.db.query.usageLogs.findMany({
      where: eq(usageLogs.userId, userId),
      orderBy: [desc(usageLogs.createdAt)],
      limit,
    });
  };

  recordUsage = async (params: {
    completionTokens: number;
    costUsd: number;
    modelId: string;
    orgId?: string | null;
    orgMemberId?: string | null;
    promptTokens: number;
    totalTokens: number;
    userId: string;
  }) => {
    const [row] = await this.db
      .insert(usageLogs)
      .values({
        completionTokens: params.completionTokens,
        costUsd: params.costUsd,
        modelId: params.modelId,
        orgId: params.orgId ?? null,
        orgMemberId: params.orgMemberId ?? null,
        promptTokens: params.promptTokens,
        totalTokens: params.totalTokens,
        userId: params.userId,
      })
      .returning();
    return row;
  };

  // ─── Trial config ──────────────────────────────────────────────────

  getTrialConfig = async () => {
    const existing = await this.db.query.platformTrialConfig.findFirst({
      where: eq(platformTrialConfig.id, 'default'),
    });
    if (existing) return existing;

    const [created] = await this.db
      .insert(platformTrialConfig)
      .values({ id: 'default' })
      .onConflictDoNothing()
      .returning();
    return (
      created ??
      (await this.db.query.platformTrialConfig.findFirst({
        where: eq(platformTrialConfig.id, 'default'),
      }))!
    );
  };

  updateTrialConfig = async (params: {
    allowedModelIds?: string[];
    durationDays?: number;
    enabled?: boolean;
    maxRequests?: number | null;
    updatedByUserId: string;
  }) => {
    await this.getTrialConfig();
    const [row] = await this.db
      .update(platformTrialConfig)
      .set({
        ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
        ...(params.durationDays !== undefined ? { durationDays: params.durationDays } : {}),
        ...(params.allowedModelIds !== undefined
          ? { allowedModelIds: JSON.stringify(params.allowedModelIds) }
          : {}),
        ...(params.maxRequests !== undefined ? { maxRequests: params.maxRequests } : {}),
        updatedByUserId: params.updatedByUserId,
      })
      .where(eq(platformTrialConfig.id, 'default'))
      .returning();
    return row;
  };

  getUserTrial = async (userId: string) => {
    return this.db.query.userTrials.findFirst({
      where: eq(userTrials.userId, userId),
    });
  };

  isPhoneBlockedForTrial = async (phone: string) => {
    const fp = fingerprintPhone(phone);
    const row = await this.db.query.trialAbuseBlocklist.findFirst({
      where: and(
        eq(trialAbuseBlocklist.fingerprintType, 'phone'),
        eq(trialAbuseBlocklist.fingerprintValue, fp),
      ),
    });
    return Boolean(row);
  };

  activateTrial = async (params: { phone: string; userId: string }) => {
    const config = await this.getTrialConfig();
    if (!config.enabled) throw new Error('TRIAL_DISABLED');

    const existing = await this.getUserTrial(params.userId);
    if (existing) throw new Error('TRIAL_ALREADY_USED');

    if (await this.isPhoneBlockedForTrial(params.phone)) {
      throw new Error('TRIAL_PHONE_BLOCKED');
    }

    const phoneFingerprint = fingerprintPhone(params.phone);
    const byPhone = await this.db.query.userTrials.findFirst({
      where: eq(userTrials.phoneFingerprint, phoneFingerprint),
    });
    if (byPhone) throw new Error('TRIAL_PHONE_ALREADY_USED');

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + config.durationDays * 24 * 60 * 60 * 1000);

    const [trial] = await this.db
      .insert(userTrials)
      .values({
        expiresAt,
        phoneFingerprint,
        startedAt,
        status: 'active',
        userId: params.userId,
      })
      .returning();
    return trial;
  };

  incrementTrialRequest = async (userId: string) => {
    const [row] = await this.db
      .update(userTrials)
      .set({ requestCount: sql`${userTrials.requestCount} + 1` })
      .where(and(eq(userTrials.userId, userId), eq(userTrials.status, 'active')))
      .returning();
    return row;
  };

  isTrialActive = async (userId: string): Promise<boolean> => {
    const trial = await this.getUserTrial(userId);
    if (!trial || trial.status !== 'active') return false;
    if (trial.expiresAt.getTime() < Date.now()) {
      await this.db
        .update(userTrials)
        .set({ status: 'expired' })
        .where(eq(userTrials.id, trial.id));
      return false;
    }
    return true;
  };

  addAbuseBlocklist = async (params: {
    email?: string | null;
    phone?: string | null;
    reason?: string;
  }) => {
    const rows: Array<{ fingerprintType: string; fingerprintValue: string; reason?: string }> = [];
    if (params.phone) {
      rows.push({
        fingerprintType: 'phone',
        fingerprintValue: fingerprintPhone(params.phone),
        reason: params.reason,
      });
    }
    if (params.email) {
      rows.push({
        fingerprintType: 'email',
        fingerprintValue: fingerprintEmail(params.email),
        reason: params.reason,
      });
    }
    if (rows.length === 0) return [];

    return this.db.insert(trialAbuseBlocklist).values(rows).onConflictDoNothing().returning();
  };

  listAllWallets = async () => {
    return this.db.query.userWallets.findMany({
      orderBy: [desc(userWallets.updatedAt)],
      limit: 200,
    });
  };

  listRecentTransactions = async (limit = 100) => {
    return this.db.query.walletTransactions.findMany({
      orderBy: [desc(walletTransactions.createdAt)],
      limit,
    });
  };
}
