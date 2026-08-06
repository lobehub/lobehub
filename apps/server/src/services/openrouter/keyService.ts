import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import {
  type BudgetPeriod,
  microUsdToDecimalString,
  openRouterUsdToMicroFloor,
  periodToOpenRouterLimitReset,
} from '@/database/utils/aicoMoney';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  createOpenRouterManagementClient,
  type OpenRouterKeyLimitReset,
  type OpenRouterManagementClient,
} from './management';

const locks = new Map<string, Promise<unknown>>();
const runExclusive = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const tail = locks.get(key) ?? Promise.resolve();
  const result = tail.then(fn, fn);
  locks.set(
    key,
    result.catch(() => undefined),
  );
  return result;
};

const microToOpenRouterLimitUsd = (micro: number): number => Number(microUsdToDecimalString(micro));

/**
 * Provisions / updates OpenRouter keys for B2C wallets and B2B member budgets.
 * Plaintext keys are encrypted with KeyVaultsGateKeeper and never returned to SPA.
 */
export class AicoOpenRouterKeyService {
  private readonly client: OpenRouterManagementClient;
  private readonly orgModel: OrganizationModel;
  private readonly billingModel: AicoBillingModel;

  constructor(
    private readonly db: LobeChatDatabase,
    client?: OpenRouterManagementClient,
  ) {
    this.client = client ?? createOpenRouterManagementClient();
    this.orgModel = new OrganizationModel(db);
    this.billingModel = new AicoBillingModel(db);
  }

  private async encryptKey(plaintext: string): Promise<string> {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    return gateKeeper.encrypt(plaintext);
  }

  async decryptKey(encrypted: string): Promise<string | null> {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(encrypted);
    return wasAuthentic ? plaintext : null;
  }

  private isStaleManagedKeyId(keyId: string | null | undefined): boolean {
    return !keyId || keyId.startsWith('mock_');
  }

  ensureUserKey = async (userId: string) => {
    return runExclusive(`user-key:${userId}`, async () => {
      const wallet = await this.billingModel.getOrCreateUserWallet(userId);
      const limitMicro = Number(wallet.balanceMicroUsd ?? 0);
      const limitUsd = microToOpenRouterLimitUsd(limitMicro);

      if (
        wallet.openrouterKeyId &&
        wallet.openrouterKeyCiphertext &&
        !this.isStaleManagedKeyId(wallet.openrouterKeyId)
      ) {
        try {
          await this.client.updateKey({
            disabled: limitMicro <= 0,
            hash: wallet.openrouterKeyId,
            limitReset: null,
            limitUsd: Math.max(limitUsd, 0),
          });
          return { created: false, keyId: wallet.openrouterKeyId };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/OpenRouter Management API (?:403|404)/.test(message)) throw error;
          console.warn('[aico] user OpenRouter key update failed; recreating', message);
        }
      }

      if (limitMicro <= 0) {
        return { created: false, keyId: null };
      }

      const created = await this.client.createKey({
        limitReset: null,
        limitUsd,
        name: `aico-user-${userId}`,
      });
      const encrypted = await this.encryptKey(created.key);
      await this.billingModel.updateUserOpenRouterKey({
        ciphertext: encrypted,
        keyId: created.hash,
        userId,
      });
      return { created: true, keyId: created.hash };
    });
  };

  ensureTrialKey = async (userId: string, budgetMicroUsd: number) => {
    const budgetMicro =
      Number.isFinite(budgetMicroUsd) && budgetMicroUsd > 0 ? Math.trunc(budgetMicroUsd) : 0;
    if (budgetMicro <= 0) {
      return { created: false, keyId: null };
    }

    return runExclusive(`user-key:${userId}`, async () => {
      const wallet = await this.billingModel.getOrCreateUserWallet(userId);

      if (wallet.openrouterKeyId && wallet.openrouterKeyCiphertext) {
        return { created: false, keyId: wallet.openrouterKeyId };
      }

      const created = await this.client.createKey({
        limitReset: null,
        limitUsd: microToOpenRouterLimitUsd(budgetMicro),
        name: `aico-trial-${userId}`,
      });
      const encrypted = await this.encryptKey(created.key);
      await this.billingModel.updateUserOpenRouterKey({
        ciphertext: encrypted,
        keyId: created.hash,
        userId,
      });
      return { created: true, keyId: created.hash };
    });
  };

  /**
   * Ensure member OpenRouter key matches funded period amount + limit_reset.
   * Never creates a key when reserved/period amount ≤ 0.
   */
  ensureMemberKey = async (orgMemberId: string) => {
    return runExclusive(`member-key:${orgMemberId}`, async () => {
      const budget = await this.orgModel.getMemberBudget(orgMemberId);
      if (!budget) throw new Error('BUDGET_NOT_FOUND');

      const period = (budget.period || 'total') as BudgetPeriod;
      const limitReset: OpenRouterKeyLimitReset = periodToOpenRouterLimitReset(period);
      const limitMicro = Number(budget.reservedMicroUsd || budget.periodAmountMicroUsd || 0);
      const limitUsd = microToOpenRouterLimitUsd(limitMicro);
      const shouldDisable =
        !budget.isActive ||
        limitMicro <= 0 ||
        budget.renewalStatus === 'renewal_pending' ||
        budget.renewalStatus === 'renewal_failed';

      if (
        budget.openrouterKeyId &&
        budget.openrouterKeyCiphertext &&
        !this.isStaleManagedKeyId(budget.openrouterKeyId)
      ) {
        try {
          await this.client.updateKey({
            disabled: shouldDisable,
            hash: budget.openrouterKeyId,
            limitReset,
            limitUsd: Math.max(limitUsd, 0),
          });
          return { created: false, keyId: budget.openrouterKeyId };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/OpenRouter Management API (?:403|404)/.test(message)) throw error;
          console.warn('[aico] member OpenRouter key update failed; recreating', message);
        }
      }

      if (limitMicro <= 0 || shouldDisable) {
        return { created: false, keyId: null };
      }

      const created = await this.client.createKey({
        limitReset,
        limitUsd,
        name: `aico-member-${orgMemberId}`,
      });
      const encrypted = await this.encryptKey(created.key);
      await this.orgModel.updateMemberOpenRouterKey({
        ciphertext: encrypted,
        keyId: created.hash,
        orgMemberId,
      });
      return { created: true, keyId: created.hash };
    });
  };

  disableMemberKey = async (orgMemberId: string) => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;
    return this.client.updateKey({ disabled: true, hash: budget.openrouterKeyId });
  };

  disableUserKey = async (userId: string) => {
    const wallet = await this.billingModel.getUserWallet(userId);
    if (!wallet?.openrouterKeyId) return null;
    return this.client.updateKey({ disabled: true, hash: wallet.openrouterKeyId });
  };

  disableAllOrgMemberKeys = async (orgId: string) => {
    const members = await this.orgModel.listMembers(orgId);
    return Promise.allSettled(members.map((m) => this.disableMemberKey(m.id)));
  };

  /**
   * Authoritative settlement helpers for removal / period close.
   * Returns micro-USD usage/remaining from OpenRouter (floored).
   */
  reclaimMemberKey = async (
    orgMemberId: string,
  ): Promise<{ remainingMicroUsd: number; usageMicroUsd: number } | null> => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;

    const info = await this.client.getKey(budget.openrouterKeyId);
    const usageMicro = Number(openRouterUsdToMicroFloor(info.usage));
    const reserved = Number(budget.reservedMicroUsd || budget.periodAmountMicroUsd || 0);
    const remainingFromOr =
      info.limitRemaining == null
        ? Math.max(0, reserved - usageMicro)
        : Number(openRouterUsdToMicroFloor(info.limitRemaining));

    await this.client.updateKey({ disabled: true, hash: budget.openrouterKeyId });

    return {
      remainingMicroUsd: Math.max(0, remainingFromOr),
      usageMicroUsd: usageMicro,
    };
  };

  /**
   * Authoritative period settlement read — unlike {@link reclaimMemberKey} it
   * leaves the key enabled, so a renewal can settle the closing period without
   * interrupting a member whose next period is about to be funded.
   */
  settleMemberPeriod = async (
    orgMemberId: string,
  ): Promise<{ remainingMicroUsd: number; usageMicroUsd: number } | null> => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;

    const info = await this.client.getKey(budget.openrouterKeyId);
    const usageMicro = Number(openRouterUsdToMicroFloor(info.usage));
    const reserved = Number(budget.reservedMicroUsd || budget.periodAmountMicroUsd || 0);
    const remaining =
      info.limitRemaining == null
        ? Math.max(0, reserved - usageMicro)
        : Number(openRouterUsdToMicroFloor(info.limitRemaining));

    await this.orgModel.syncMemberBudgetUsage({
      orgMemberId,
      settledUsageMicroUsd: usageMicro,
    });

    return { remainingMicroUsd: Math.max(0, remaining), usageMicroUsd: usageMicro };
  };

  /**
   * @deprecated Prefer explicit billing context via AicoManagedPolicy.
   * Kept only for transitional non-managed diagnostics — returns null always
   * so silent first-match billing cannot occur.
   */
  resolveUserApiKey = async (_userId: string): Promise<string | null> => null;

  /**
   * Spendable remaining for a personal wallet. Prefers OpenRouter
   * `limit_remaining` (enforced spend left on the managed key); falls back to
   * deposited `balanceMicroUsd` when no key exists or OR is unreachable.
   */
  getUserRemaining = async (
    userId: string,
  ): Promise<{ remainingMicroUsd: number; usageMicroUsd: number | null }> => {
    const wallet = await this.billingModel.getOrCreateUserWallet(userId);
    const balanceMicroUsd = Number(wallet.balanceMicroUsd ?? 0);

    if (!wallet.openrouterKeyId || this.isStaleManagedKeyId(wallet.openrouterKeyId)) {
      return { remainingMicroUsd: Math.max(0, balanceMicroUsd), usageMicroUsd: null };
    }

    try {
      const info = await this.client.getKey(wallet.openrouterKeyId);
      const usageMicro = Number(openRouterUsdToMicroFloor(info.usage));
      const remaining =
        info.limitRemaining == null
          ? Math.max(0, balanceMicroUsd - usageMicro)
          : Number(openRouterUsdToMicroFloor(info.limitRemaining));
      return { remainingMicroUsd: Math.max(0, remaining), usageMicroUsd: usageMicro };
    } catch {
      return { remainingMicroUsd: Math.max(0, balanceMicroUsd), usageMicroUsd: null };
    }
  };

  syncMemberUsage = async (orgMemberId: string) => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;
    const info = await this.client.getKey(budget.openrouterKeyId);
    return this.orgModel.syncMemberBudgetUsage({
      orgMemberId,
      settledUsageMicroUsd: Number(openRouterUsdToMicroFloor(info.usage)),
    });
  };
}
