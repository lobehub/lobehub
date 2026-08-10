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
  private readonly _client: OpenRouterManagementClient | null | undefined;
  private readonly decryptOnly: boolean;
  private readonly orgModel: OrganizationModel;
  private readonly billingModel: AicoBillingModel;

  /**
   * @param client Injected management client (tests). Pass `null` for decrypt-only
   *   usage so the OpenRouter management client is never constructed.
   */
  constructor(
    private readonly db: LobeChatDatabase,
    client?: OpenRouterManagementClient | null,
  ) {
    this.decryptOnly = client === null;
    this._client = client;
    this.orgModel = new OrganizationModel(db);
    this.billingModel = new AicoBillingModel(db);
  }

  private get client(): OpenRouterManagementClient {
    if (this.decryptOnly) {
      throw new Error('AicoOpenRouterKeyService is decrypt-only — management client unavailable');
    }
    if (this._client) return this._client;
    const created = createOpenRouterManagementClient();
    (this as { _client: OpenRouterManagementClient })._client = created;
    return created;
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

  /**
   * Current-cycle spendable limit for OpenRouter (FIN-001).
   * Pending next-period reservations inflate `reservedMicroUsd` but must not
   * raise the live key limit until renewal applies them.
   */
  private currentCycleLimitMicro(budget: {
    periodAmountMicroUsd?: number | null;
    reservedMicroUsd?: number | null;
  }): number {
    const periodAmount = Number(budget.periodAmountMicroUsd ?? 0);
    if (periodAmount > 0) return periodAmount;
    return Number(budget.reservedMicroUsd ?? 0);
  }

  /** Best-effort retire a managed key before recreating (FIN-004). */
  private async retireManagedKey(hash: string): Promise<void> {
    try {
      await this.client.updateKey({ disabled: true, hash });
    } catch (error) {
      console.warn('[aico] failed to disable stale OpenRouter key before recreate', error);
    }
    try {
      await this.client.deleteKey(hash);
    } catch (error) {
      console.warn('[aico] failed to delete stale OpenRouter key before recreate', error);
    }
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
          await this.retireManagedKey(wallet.openrouterKeyId);
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
      // FIN-001: never use reservedMicroUsd here — it may include pending next-period funds.
      const limitMicro = this.currentCycleLimitMicro(budget);
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
          await this.retireManagedKey(budget.openrouterKeyId);
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
   * Requires orgId so a foreign orgMemberId cannot disable another tenant's key.
   */
  reclaimMemberKey = async (params: {
    orgId: string;
    orgMemberId: string;
  }): Promise<{ remainingMicroUsd: number; usageMicroUsd: number } | null> => {
    const budget = await this.orgModel.getMemberBudgetForOrg(params);
    if (!budget?.openrouterKeyId) return null;

    const info = await this.client.getKey(budget.openrouterKeyId);
    const usageMicro = Number(openRouterUsdToMicroFloor(info.usage));
    const currentCycle = this.currentCycleLimitMicro(budget);
    const pendingHeld = Math.max(0, Number(budget.pendingPeriodAmountMicroUsd ?? 0));
    const remainingFromOr =
      info.limitRemaining == null
        ? Math.max(0, currentCycle - usageMicro)
        : Number(openRouterUsdToMicroFloor(info.limitRemaining));

    await this.client.updateKey({ disabled: true, hash: budget.openrouterKeyId });

    // Pending next-period reservation was never spendable on the OR key (FIN-001) —
    // reclaim it from the wallet reservation in full.
    return {
      remainingMicroUsd: Math.max(0, remainingFromOr) + pendingHeld,
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
    // Settle the closing cycle only — leave pending next-period funds untouched.
    const currentCycle = this.currentCycleLimitMicro(budget);
    const remaining =
      info.limitRemaining == null
        ? Math.max(0, currentCycle - usageMicro)
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
