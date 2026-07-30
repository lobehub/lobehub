import { ChatErrorType } from '@lobechat/types';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

export class AicoChatGuardError extends Error {
  errorType: string;

  constructor(message: string, errorType: string = ChatErrorType.InvalidUserKey) {
    super(message);
    this.name = 'AicoChatGuardError';
    this.errorType = errorType;
  }
}

/**
 * Pre-chat checks + resolve managed OpenRouter key for Aico-branded traffic.
 */
export class AicoChatGuard {
  private readonly orgModel: OrganizationModel;
  private readonly billingModel: AicoBillingModel;
  private readonly keyService: AicoOpenRouterKeyService;

  constructor(db: LobeChatDatabase) {
    this.orgModel = new OrganizationModel(db);
    this.billingModel = new AicoBillingModel(db);
    this.keyService = new AicoOpenRouterKeyService(db);
  }

  /**
   * Providers that should use Aico-managed OpenRouter keys.
   */
  static isManagedProvider(provider: string): boolean {
    return provider === 'aico' || provider === 'openrouter';
  }

  /**
   * Runtime provider id for ModelRuntime (aico → openrouter).
   */
  static resolveRuntimeProvider(provider: string): string {
    return provider === 'aico' ? 'openrouter' : provider;
  }

  assertModelAllowed = async (userId: string, modelId: string) => {
    const orgs = await this.orgModel.listForUser(userId);
    for (const org of orgs) {
      const members = await this.orgModel.listMembers(org.id);
      const me = members.find((m) => m.userId === userId && m.status === 'active');
      if (!me) continue;
      const allowed = await this.orgModel.getAllowedModelsForMember(me.id);
      if (allowed && !allowed.includes(modelId)) {
        throw new AicoChatGuardError(`MODEL_NOT_ALLOWED:${modelId}`, ChatErrorType.BadRequest);
      }
    }

    const trial = await this.billingModel.getUserTrial(userId);
    if (trial && (await this.billingModel.isTrialActive(userId))) {
      const config = await this.billingModel.getTrialConfig();
      const allowed = JSON.parse(config.allowedModelIds || '[]') as string[];
      if (allowed.length > 0 && !allowed.includes(modelId)) {
        throw new AicoChatGuardError(
          `TRIAL_MODEL_NOT_ALLOWED:${modelId}`,
          ChatErrorType.BadRequest,
        );
      }
      if (config.maxRequests != null && trial.requestCount >= config.maxRequests) {
        throw new AicoChatGuardError('TRIAL_REQUEST_LIMIT', ChatErrorType.SubscriptionPlanLimit);
      }
    }
  };

  /**
   * Returns decrypted API key for managed chat, or null to fall through to user/env keys.
   */
  resolveManagedApiKey = async (userId: string): Promise<string | null> => {
    const trialActive = await this.billingModel.isTrialActive(userId);
    const key = await this.keyService.resolveUserApiKey(userId);

    if (key) return key;

    // Trial without personal/org key: fall back to env OPENROUTER_API_KEY via runtime
    if (trialActive) return null;

    return null;
  };

  recordTrialRequest = async (userId: string) => {
    if (await this.billingModel.isTrialActive(userId)) {
      await this.billingModel.incrementTrialRequest(userId);
    }
  };
}
