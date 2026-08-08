import { ChatErrorType, type ErrorType } from '@lobechat/types';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import { microUsdToDecimalString } from '@/database/utils/aicoMoney';
import { aicoEnv } from '@/envs/aico';

import { type AicoBillingContext, parseAicoBillingContext } from './billingContext';

export class AicoManagedPolicyError extends Error {
  errorType: ErrorType;
  code: string;

  constructor(code: string, errorType: ErrorType = ChatErrorType.InvalidUserKey) {
    super(code);
    this.name = 'AicoManagedPolicyError';
    this.code = code;
    this.errorType = errorType;
  }
}

export interface ManagedExecutionContext {
  /** Decrypted OpenRouter key — never log. */
  apiKey: string;
  billing: AicoBillingContext;
  budgetId?: string;
  modelId?: string;
  orgId?: string;
  orgMemberId?: string;
  userId: string;
}

/**
 * Single mandatory policy boundary for every managed OpenRouter/`aico` runtime path.
 * Default for missing/invalid context: deny.
 */
export class AicoManagedPolicy {
  private readonly orgModel: OrganizationModel;
  private readonly billingModel: AicoBillingModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly decryptKey: (ciphertext: string) => Promise<string | null>,
  ) {
    this.orgModel = new OrganizationModel(db);
    this.billingModel = new AicoBillingModel(db);
  }

  static isManagedProvider(provider: string): boolean {
    return provider === 'aico' || provider === 'openrouter';
  }

  static resolveRuntimeProvider(provider: string): string {
    return provider === 'aico' ? 'openrouter' : provider;
  }

  /**
   * Trial is disabled in production until atomic maxRequests ships.
   * Missing config / unset flags default to disabled.
   */
  assertTrialAllowed = async (): Promise<void> => {
    if (process.env.NODE_ENV === 'production') {
      throw new AicoManagedPolicyError('TRIAL_DISABLED_IN_PRODUCTION', ChatErrorType.Forbidden);
    }
    if (!aicoEnv.AICO_ALLOW_TRIAL) {
      throw new AicoManagedPolicyError('TRIAL_DISABLED', ChatErrorType.Forbidden);
    }
    const config = await this.billingModel.getTrialConfig();
    if (!config.enabled) {
      throw new AicoManagedPolicyError('TRIAL_DISABLED', ChatErrorType.Forbidden);
    }
  };

  authorize = async (params: {
    userId: string;
    billing: unknown;
    modelId?: string;
  }): Promise<ManagedExecutionContext> => {
    let billing: AicoBillingContext;
    try {
      billing = parseAicoBillingContext(params.billing);
    } catch (error) {
      const code =
        error instanceof Error && error.message.startsWith('BILLING_CONTEXT_')
          ? error.message
          : 'BILLING_CONTEXT_INVALID';
      throw new AicoManagedPolicyError(code, ChatErrorType.BadRequest);
    }

    if (params.modelId) {
      await this.assertModelAllowed(params.userId, billing, params.modelId);
    }

    if (billing.source === 'personal') {
      // Trial uses personal wallet key path but product Trial is disabled in prod.
      if (await this.billingModel.isTrialActive(params.userId)) {
        await this.assertTrialAllowed();
      }

      const wallet = await this.billingModel.getUserWallet(params.userId);
      if (!wallet?.isActive) {
        throw new AicoManagedPolicyError('PERSONAL_WALLET_INACTIVE', ChatErrorType.InvalidUserKey);
      }
      if (!wallet.openrouterKeyCiphertext || !wallet.openrouterKeyId) {
        throw new AicoManagedPolicyError('MANAGED_KEY_UNAVAILABLE', ChatErrorType.InvalidUserKey);
      }
      if (
        (wallet.balanceMicroUsd ?? 0) <= 0 &&
        !(await this.billingModel.isTrialActive(params.userId))
      ) {
        throw new AicoManagedPolicyError(
          'PERSONAL_FUNDS_UNAVAILABLE',
          ChatErrorType.InvalidUserKey,
        );
      }

      const apiKey = await this.decryptKey(wallet.openrouterKeyCiphertext);
      if (!apiKey) {
        throw new AicoManagedPolicyError(
          'MANAGED_KEY_DECRYPT_FAILED',
          ChatErrorType.InvalidUserKey,
        );
      }

      return {
        apiKey,
        billing,
        userId: params.userId,
        modelId: params.modelId,
      };
    }

    const org = await this.orgModel.getById(billing.organizationId);
    if (!org || org.status !== 'active') {
      throw new AicoManagedPolicyError('ORG_NOT_ACTIVE', ChatErrorType.Forbidden);
    }

    const role = await this.orgModel.getMemberRole(params.userId, billing.organizationId);
    if (!role) {
      throw new AicoManagedPolicyError('ORG_MEMBERSHIP_REQUIRED', ChatErrorType.Forbidden);
    }

    const members = await this.orgModel.listMembers(billing.organizationId);
    const me = members.find((m) => m.userId === params.userId && m.status === 'active');
    if (!me) {
      throw new AicoManagedPolicyError('ORG_MEMBERSHIP_REQUIRED', ChatErrorType.Forbidden);
    }

    const budget = await this.orgModel.getMemberBudget(me.id);
    if (!budget?.isActive) {
      throw new AicoManagedPolicyError('MEMBER_BUDGET_INACTIVE', ChatErrorType.InvalidUserKey);
    }
    if (budget.renewalStatus === 'renewal_pending' || budget.renewalStatus === 'renewal_failed') {
      throw new AicoManagedPolicyError(
        'MEMBER_BUDGET_RENEWAL_BLOCKED',
        ChatErrorType.InvalidUserKey,
      );
    }
    if ((budget.reservedMicroUsd ?? 0) <= 0) {
      throw new AicoManagedPolicyError('MEMBER_BUDGET_UNFUNDED', ChatErrorType.InvalidUserKey);
    }
    if (!budget.openrouterKeyCiphertext || !budget.openrouterKeyId) {
      throw new AicoManagedPolicyError('MANAGED_KEY_UNAVAILABLE', ChatErrorType.InvalidUserKey);
    }

    const apiKey = await this.decryptKey(budget.openrouterKeyCiphertext);
    if (!apiKey) {
      throw new AicoManagedPolicyError('MANAGED_KEY_DECRYPT_FAILED', ChatErrorType.InvalidUserKey);
    }

    return {
      apiKey,
      billing,
      budgetId: budget.id,
      modelId: params.modelId,
      orgId: org.id,
      orgMemberId: me.id,
      userId: params.userId,
    };
  };

  private assertModelAllowed = async (
    userId: string,
    billing: AicoBillingContext,
    modelId: string,
  ) => {
    if (billing.source === 'organization') {
      const members = await this.orgModel.listMembers(billing.organizationId);
      const me = members.find((m) => m.userId === userId && m.status === 'active');
      if (!me) {
        throw new AicoManagedPolicyError('ORG_MEMBERSHIP_REQUIRED', ChatErrorType.Forbidden);
      }
      const allowed = await this.orgModel.getAllowedModelsForMember(me.id);
      if (!allowed || allowed.length === 0 || !allowed.includes(modelId)) {
        throw new AicoManagedPolicyError(`MODEL_NOT_ALLOWED:${modelId}`, ChatErrorType.BadRequest);
      }
      return;
    }

    // Personal / trial allow-list from trial config when trial active
    if (await this.billingModel.isTrialActive(userId)) {
      await this.assertTrialAllowed();
      const config = await this.billingModel.getTrialConfig();
      const allowed = JSON.parse(config.allowedModelIds || '[]') as string[];
      if (allowed.length > 0 && !allowed.includes(modelId)) {
        throw new AicoManagedPolicyError(
          `TRIAL_MODEL_NOT_ALLOWED:${modelId}`,
          ChatErrorType.BadRequest,
        );
      }
    }
  };

  /** Serialize wallet micro amounts for API responses (never return raw bigint). */
  static moneyFields(micro: number | bigint) {
    return {
      balanceMicroUsd: String(micro),
      balanceUsd: microUsdToDecimalString(micro),
    };
  }
}
