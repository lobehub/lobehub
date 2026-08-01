import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { createOpenRouterManagementClient, type OpenRouterManagementClient } from './management';

/**
 * In-process mutex keyed by an arbitrary string. Serializes concurrent
 * "check key exists, else create" calls for the same wallet/budget within a
 * single server process so a double-submit (e.g. two rapid topup calls)
 * cannot both observe an empty key and provision two orphaned OpenRouter keys.
 * Does not protect across multiple server instances — a real fix would need a
 * DB-level unique constraint or advisory lock, out of scope here.
 */
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

  /**
   * Ensure a B2C user has an OpenRouter key whose limit matches wallet balance USD.
   */
  ensureUserKey = async (userId: string) => {
    return runExclusive(`user-key:${userId}`, async () => {
      const wallet = await this.billingModel.getOrCreateUserWallet(userId);
      const limitUsd = Number(wallet.balanceUsd);

      if (
        wallet.openrouterKeyId &&
        wallet.openrouterKeyHash &&
        !this.isStaleManagedKeyId(wallet.openrouterKeyId)
      ) {
        try {
          await this.client.updateKey({
            disabled: limitUsd <= 0,
            hash: wallet.openrouterKeyId,
            limitUsd: Math.max(limitUsd, 0),
          });
          return { created: false, keyId: wallet.openrouterKeyId };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/OpenRouter Management API (?:403|404)/.test(message)) throw error;
          console.warn(
            '[aico] user OpenRouter key update failed; recreating',
            wallet.openrouterKeyId,
            message,
          );
        }
      }

      if (limitUsd <= 0) {
        return { created: false, keyId: null };
      }

      const created = await this.client.createKey({
        limitUsd,
        name: `aico-user-${userId}`,
      });
      const encrypted = await this.encryptKey(created.key);
      await this.billingModel.updateUserOpenRouterKey({
        encryptedKey: encrypted,
        keyId: created.hash,
        userId,
      });
      return { created: true, keyId: created.hash };
    });
  };

  /**
   * Create a trial-only OpenRouter key with a fixed USD limit. Never touches the
   * paid wallet balance — trial spend is isolated from real top-ups. No-ops if the
   * wallet already has a managed key (paid or trial), so a paid top-up always wins.
   */
  ensureTrialKey = async (userId: string, budgetUsd: number) => {
    const budget = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0.01;

    return runExclusive(`user-key:${userId}`, async () => {
      const wallet = await this.billingModel.getOrCreateUserWallet(userId);

      if (wallet.openrouterKeyId && wallet.openrouterKeyHash) {
        return { created: false, keyId: wallet.openrouterKeyId };
      }

      const created = await this.client.createKey({
        limitUsd: budget,
        name: `aico-trial-${userId}`,
      });
      const encrypted = await this.encryptKey(created.key);
      await this.billingModel.updateUserOpenRouterKey({
        encryptedKey: encrypted,
        keyId: created.hash,
        userId,
      });
      return { created: true, keyId: created.hash };
    });
  };

  /**
   * True for in-process mock key ids (`mock_…`) that OpenRouter will reject.
   * After switching from mock → real management key, these must be replaced.
   */
  private isStaleManagedKeyId(keyId: string | null | undefined): boolean {
    return !keyId || keyId.startsWith('mock_');
  }

  /**
   * Ensure an org member budget has an OpenRouter key matching limitUsd.
   */
  ensureMemberKey = async (orgMemberId: string) => {
    return runExclusive(`member-key:${orgMemberId}`, async () => {
      const budget = await this.orgModel.getMemberBudget(orgMemberId);
      if (!budget) throw new Error('BUDGET_NOT_FOUND');

      const limitUsd = Number(budget.limitUsd);

      if (
        budget.openrouterKeyId &&
        budget.openrouterKeyHash &&
        !this.isStaleManagedKeyId(budget.openrouterKeyId)
      ) {
        try {
          await this.client.updateKey({
            disabled: !budget.isActive || limitUsd <= 0,
            hash: budget.openrouterKeyId,
            limitUsd: Math.max(limitUsd, 0),
          });
          return { created: false, keyId: budget.openrouterKeyId };
        } catch (error) {
          // Orphaned / foreign-account key — recreate instead of blocking allocate.
          const message = error instanceof Error ? error.message : String(error);
          if (!/OpenRouter Management API (?:403|404)/.test(message)) throw error;
          console.warn(
            '[aico] member OpenRouter key update failed; recreating',
            budget.openrouterKeyId,
            message,
          );
        }
      }

      const created = await this.client.createKey({
        limitUsd: Math.max(limitUsd, 0.01),
        name: `aico-member-${orgMemberId}`,
      });
      const encrypted = await this.encryptKey(created.key);
      await this.orgModel.updateMemberOpenRouterKey({
        encryptedKey: encrypted,
        keyId: created.hash,
        orgMemberId,
      });
      return { created: true, keyId: created.hash };
    });
  };

  /** Disable (but keep) an org member's managed OpenRouter key — e.g. on remove/suspend. */
  disableMemberKey = async (orgMemberId: string) => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;
    return this.client.updateKey({ disabled: true, hash: budget.openrouterKeyId });
  };

  /** Disable every member key in an org — used when a platform admin suspends the org. */
  disableAllOrgMemberKeys = async (orgId: string) => {
    const members = await this.orgModel.listMembers(orgId);
    return Promise.allSettled(members.map((m) => this.disableMemberKey(m.id)));
  };

  /**
   * Reclaim a member's OpenRouter key on remove/revoke: reads the OpenRouter-reported
   * remaining credit, disables the key so it can never be spent again, then returns
   * `remainingUsd` for the caller to credit back to the org wallet.
   */
  reclaimMemberKey = async (
    orgMemberId: string,
  ): Promise<{ remainingUsd: number; usageUsd: number } | null> => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;

    const info = await this.client.getKey(budget.openrouterKeyId);
    const remainingUsd =
      info.limitRemaining ?? Math.max(0, (info.limit ?? Number(budget.limitUsd)) - info.usage);

    await this.client.updateKey({ disabled: true, hash: budget.openrouterKeyId });

    return { remainingUsd, usageUsd: info.usage };
  };

  /**
   * Resolve plaintext key for server-side chat injection. Never expose via tRPC.
   * Suspended orgs are already excluded by `listForUser`; inactive budgets are
   * skipped explicitly below.
   */
  resolveUserApiKey = async (userId: string): Promise<string | null> => {
    // Prefer org member budget key if user is in an org with a budget
    const orgs = await this.orgModel.listForUser(userId);
    for (const org of orgs) {
      const members = await this.orgModel.listMembers(org.id);
      const me = members.find((m) => m.userId === userId && m.status === 'active');
      if (!me) continue;
      const budget = await this.orgModel.getMemberBudget(me.id);
      if (budget?.openrouterKeyHash && budget.isActive) {
        return this.decryptKey(budget.openrouterKeyHash);
      }
    }

    const wallet = await this.billingModel.getUserWallet(userId);
    if (!wallet?.openrouterKeyHash || !wallet.isActive) return null;
    return this.decryptKey(wallet.openrouterKeyHash);
  };

  syncMemberUsage = async (orgMemberId: string) => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;
    const info = await this.client.getKey(budget.openrouterKeyId);
    return this.orgModel.syncMemberBudgetUsage({
      orgMemberId,
      usedUsd: info.usage,
    });
  };
}
