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

/**
 * Iranian mobile → E.164 normalization, duplicated (not imported) from
 * `src/libs/better-auth/phone.ts` — the database package cannot depend on
 * app-level `src/` code. Keep this in lockstep with that file.
 *
 * Fingerprints MUST be derived from a single canonical form, or distinct raw
 * inputs (`09121234567`, `+989121234567`, Persian digits, …) for the same
 * underlying number would produce distinct fingerprints and defeat trial
 * abuse detection / the unique phone-fingerprint constraint.
 */
const IR_MOBILE_E164 = /^\+989\d{9}$/;
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const toAsciiDigits = (value: string): string =>
  value.replaceAll(/[۰-۹٠-٩]/g, (ch) => {
    const persian = PERSIAN_DIGITS.indexOf(ch);
    if (persian >= 0) return String(persian);
    const arabic = ARABIC_INDIC_DIGITS.indexOf(ch);
    return arabic >= 0 ? String(arabic) : ch;
  });

const stripPhoneNoise = (value: string): string =>
  toAsciiDigits(value).replaceAll(/[\s\-()]/g, '').trim();

/** Normalizes an Iranian mobile number to E.164. Throws `INVALID_PHONE` if implausible. */
export const normalizeIranianPhoneForFingerprint = (raw: string): string => {
  const cleaned = stripPhoneNoise(raw);
  if (!cleaned) throw new Error('INVALID_PHONE');

  if (IR_MOBILE_E164.test(cleaned)) return cleaned;

  if (/^\+98/.test(cleaned)) {
    const digits = cleaned.slice(1);
    if (/^989\d{9}$/.test(digits)) return `+${digits}`;
    throw new Error('INVALID_PHONE');
  }

  if (/^989\d{9}$/.test(cleaned)) return `+${cleaned}`;

  const digits = cleaned.replaceAll(/\D/g, '');
  if (/^0?9\d{9}$/.test(digits)) {
    const national = digits.startsWith('0') ? digits.slice(1) : digits;
    return `+98${national}`;
  }

  throw new Error('INVALID_PHONE');
};

/** Postgres unique_violation. */
const isUniqueConstraintViolation = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');

export const fingerprintPhone = (phone: string): string =>
  createHash('sha256').update(`phone:${normalizeIranianPhoneForFingerprint(phone)}`).digest('hex');

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
    amountMicroUsd: number;
    amountToman: number;
    createdByUserId: string;
    fxRateTomanPerUsd: number;
    gatewayRefId?: string;
    userId: string;
  }) => {
    if (!Number.isInteger(params.amountToman) || params.amountToman <= 0) {
      throw new Error('AMOUNT_TOMAN_MUST_BE_POSITIVE_INTEGER');
    }
    if (!Number.isInteger(params.amountMicroUsd) || params.amountMicroUsd <= 0) {
      throw new Error('AMOUNT_MICRO_USD_MUST_BE_POSITIVE_INTEGER');
    }

    return this.db.transaction(async (tx) => {
      await tx.insert(userWallets).values({ userId: params.userId }).onConflictDoNothing({
        target: userWallets.userId,
      });

      const [txRow] = await tx
        .insert(walletTransactions)
        .values({
          amountMicroUsd: params.amountMicroUsd,
          amountToman: params.amountToman,
          createdByUserId: params.createdByUserId,
          description: 'Mock topup',
          fxRateTomanPerUsd: params.fxRateTomanPerUsd,
          gatewayRefId: params.gatewayRefId ?? `mock_${Date.now()}`,
          type: 'topup',
          userId: params.userId,
        })
        .returning();

      const [wallet] = await tx
        .update(userWallets)
        .set({
          balanceMicroUsd: sql`${userWallets.balanceMicroUsd} + ${params.amountMicroUsd}`,
          balanceToman: sql`${userWallets.balanceToman} + ${params.amountToman}`,
          isActive: true,
        })
        .where(eq(userWallets.userId, params.userId))
        .returning();

      return { transaction: txRow, wallet };
    });
  };

  /**
   * UX-only preference for which wallet the SPA pre-selects. Authorization always
   * re-derives the billing context from the request — never from this column.
   */
  setBillingPreference = async (params: {
    organizationId?: string | null;
    source: 'personal' | 'organization';
    userId: string;
  }) => {
    await this.getOrCreateUserWallet(params.userId);
    const [row] = await this.db
      .update(userWallets)
      .set({
        preferredBillingSource: params.source,
        preferredOrganizationId:
          params.source === 'organization' ? (params.organizationId ?? null) : null,
      })
      .where(eq(userWallets.userId, params.userId))
      .returning();
    return row;
  };

  updateUserOpenRouterKey = async (params: {
    ciphertext: string;
    keyId: string;
    userId: string;
  }) => {
    await this.getOrCreateUserWallet(params.userId);
    const [row] = await this.db
      .update(userWallets)
      .set({
        openrouterKeyCiphertext: params.ciphertext,
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

  /** UX preference only — never authorize managed requests from this alone. */
  setBillingPreference = async (params: {
    preferredBillingSource: 'personal' | 'organization';
    preferredOrganizationId?: string | null;
    userId: string;
  }) => {
    await this.getOrCreateUserWallet(params.userId);
    const [row] = await this.db
      .update(userWallets)
      .set({
        preferredBillingSource: params.preferredBillingSource,
        preferredOrganizationId:
          params.preferredBillingSource === 'organization'
            ? (params.preferredOrganizationId ?? null)
            : null,
      })
      .where(eq(userWallets.userId, params.userId))
      .returning();
    return row;
  };

  listUserUsage = async (userId: string, limit = 50) => {
    return this.db.query.usageLogs.findMany({
      where: eq(usageLogs.userId, userId),
      orderBy: [desc(usageLogs.createdAt)],
      limit,
    });
  };

  recordUsage = async (params: {
    billingSource: 'personal' | 'organization';
    completionTokens: number;
    costMicroUsd: number;
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
        billingSource: params.billingSource,
        completionTokens: params.completionTokens,
        costMicroUsd: params.costMicroUsd,
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
    trialBudgetMicroUsd?: number;
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
        ...(params.trialBudgetMicroUsd !== undefined
          ? { trialBudgetMicroUsd: params.trialBudgetMicroUsd }
          : {}),
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

  /**
   * Activates a trial. Pre-checks both uniqueness constraints (per-user,
   * per-phone-fingerprint) for a clean error message, then relies on the DB's
   * unique indexes (`user_trials_user_id_uidx`,
   * `user_trials_phone_fingerprint_uidx`) as the actual race-safe guard —
   * concurrent activations can never create two trials for the same phone.
   */
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

    try {
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
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const constraint = (error as { constraint?: string }).constraint ?? '';
      throw new Error(constraint.includes('user_id') ? 'TRIAL_ALREADY_USED' : 'TRIAL_PHONE_ALREADY_USED');
    }
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

  /** Sum of `usage_logs.cost_micro_usd` across all B2C + B2B traffic — real OpenRouter spend. */
  sumUsageCostMicroUsd = async (): Promise<number> => {
    const [row] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${usageLogs.costMicroUsd}), 0)` })
      .from(usageLogs);
    return Number(row?.total ?? 0);
  };
}
