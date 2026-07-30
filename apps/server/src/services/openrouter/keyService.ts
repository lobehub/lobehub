import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { createOpenRouterManagementClient, type OpenRouterManagementClient } from './management';

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
    const wallet = await this.billingModel.getOrCreateUserWallet(userId);
    const limitUsd = Number(wallet.balanceUsd);

    if (wallet.openrouterKeyId && wallet.openrouterKeyHash) {
      await this.client.updateKey({
        disabled: limitUsd <= 0,
        hash: wallet.openrouterKeyId,
        limitUsd: Math.max(limitUsd, 0),
      });
      return { created: false, keyId: wallet.openrouterKeyId };
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
  };

  /**
   * Ensure an org member budget has an OpenRouter key matching limitUsd.
   */
  ensureMemberKey = async (orgMemberId: string) => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget) throw new Error('BUDGET_NOT_FOUND');

    const limitUsd = Number(budget.limitUsd);

    if (budget.openrouterKeyId && budget.openrouterKeyHash) {
      await this.client.updateKey({
        disabled: !budget.isActive || limitUsd <= 0,
        hash: budget.openrouterKeyId,
        limitUsd: Math.max(limitUsd, 0),
      });
      return { created: false, keyId: budget.openrouterKeyId };
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
  };

  /**
   * Resolve plaintext key for server-side chat injection. Never expose via tRPC.
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
