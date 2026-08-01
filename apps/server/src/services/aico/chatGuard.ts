import { ChatErrorType, type ErrorType } from '@lobechat/types';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import type { LobeChatDatabase } from '@/database/type';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

export class AicoChatGuardError extends Error {
  errorType: ErrorType;

  constructor(message: string, errorType: ErrorType = ChatErrorType.InvalidUserKey) {
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

  /**
   * `listForUser` already excludes suspended orgs, so a membership that only
   * exists in a suspended org contributes no allow-list here — the member simply
   * has no managed key to resolve (see `resolveManagedApiKey`), which denies chat
   * downstream rather than granting unrestricted access.
   */
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
   * Returns the decrypted API key for managed chat, or `null` when the caller has
   * no managed key and is not on an active trial — the runtime must treat `null`
   * as "no managed credentials" and must NOT fall back to a shared env API key.
   *
   * Fail closed: an active trial without a resolvable key throws instead of
   * returning `null`, so a provisioning failure can never silently fall through
   * to a shared/env OpenRouter key.
   */
  resolveManagedApiKey = async (userId: string): Promise<string | null> => {
    const key = await this.keyService.resolveUserApiKey(userId);
    if (key) return key;

    if (await this.billingModel.isTrialActive(userId)) {
      throw new AicoChatGuardError('TRIAL_KEY_UNAVAILABLE', ChatErrorType.InvalidUserKey);
    }

    return null;
  };

  recordTrialRequest = async (userId: string) => {
    if (await this.billingModel.isTrialActive(userId)) {
      await this.billingModel.incrementTrialRequest(userId);
    }
  };

  /**
   * Post-chat bookkeeping for managed traffic: bumps trial usage, syncs the org
   * member's OpenRouter-reported spend (source of truth for budgets), and always
   * records a `usage_logs` row — with `costUsd: 0` when the caller doesn't know
   * the real cost yet, so per-request analytics stay complete even before sync.
   */
  afterManagedChat = async (
    userId: string,
    params: {
      completionTokens?: number;
      costUsd?: number;
      modelId: string;
      promptTokens?: number;
      totalTokens?: number;
    },
  ): Promise<void> => {
    await this.recordTrialRequest(userId);

    let orgId: string | null = null;
    let orgMemberId: string | null = null;

    const orgs = await this.orgModel.listForUser(userId);
    for (const org of orgs) {
      const members = await this.orgModel.listMembers(org.id);
      const me = members.find((m) => m.userId === userId && m.status === 'active');
      if (!me) continue;
      const budget = await this.orgModel.getMemberBudget(me.id);
      if (budget?.openrouterKeyId) {
        orgId = org.id;
        orgMemberId = me.id;
        await this.keyService.syncMemberUsage(me.id).catch(() => null);
        break;
      }
    }

    await this.billingModel.recordUsage({
      completionTokens: params.completionTokens ?? 0,
      costUsd: params.costUsd ?? 0,
      modelId: params.modelId,
      orgId,
      orgMemberId,
      promptTokens: params.promptTokens ?? 0,
      totalTokens: params.totalTokens ?? 0,
      userId,
    });
  };
}
