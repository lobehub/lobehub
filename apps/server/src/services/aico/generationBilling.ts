import { ChatErrorType } from '@lobechat/types';

import {
  type AicoBillingContext,
  parseAicoBillingContext,
} from '@/server/services/aico/billingContext';
import { AicoManagedPolicy, AicoManagedPolicyError } from '@/server/services/aico/managedPolicy';

/**
 * Image-tab clones use `{baseId}:image`. Org/trial allow-lists store the chat
 * model id without that suffix — normalize before authorize().
 */
export const toManagedGenerationModelId = (modelId: string): string =>
  modelId.endsWith(':image') ? modelId.slice(0, -':image'.length) : modelId;

/**
 * Aico generation (image/video) must use wallet-backed OpenRouter/`aico` and an
 * explicit billing context — same contract as chat webapi.
 */
export const resolveManagedGenerationBilling = (params: {
  aicoBilling: unknown;
  provider: string;
}): AicoBillingContext => {
  if (!AicoManagedPolicy.isManagedProvider(params.provider)) {
    throw new AicoManagedPolicyError('DIRECT_PROVIDER_NOT_ALLOWED', ChatErrorType.BadRequest);
  }

  try {
    return parseAicoBillingContext(params.aicoBilling);
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith('BILLING_CONTEXT_')
        ? error.message
        : 'BILLING_CONTEXT_INVALID';
    throw new AicoManagedPolicyError(code, ChatErrorType.BadRequest);
  }
};

export const managedPolicyErrorToTrpc = (error: AicoManagedPolicyError) => ({
  code: 'BAD_REQUEST' as const,
  message: error.code || error.message,
});

/**
 * Billing context for server-side generation tools that have no client header.
 * Uses the user's stored wallet preference — not a first-match inference.
 */
export const resolvePreferredGenerationBilling = async (
  getWallet: (userId: string) => Promise<{
    preferredBillingSource: string | null;
    preferredOrganizationId: string | null;
  } | null>,
  userId: string,
): Promise<AicoBillingContext> => {
  const wallet = await getWallet(userId);
  if (
    wallet?.preferredBillingSource === 'organization' &&
    typeof wallet.preferredOrganizationId === 'string' &&
    wallet.preferredOrganizationId.trim()
  ) {
    return { organizationId: wallet.preferredOrganizationId.trim(), source: 'organization' };
  }
  return { source: 'personal' };
};

export const isManagedGenerationProvider = (provider: string): boolean =>
  AicoManagedPolicy.isManagedProvider(provider);

export const filterManagedGenerationProviders = <T extends { id: string }>(providers: T[]): T[] =>
  providers.filter((item) => isManagedGenerationProvider(item.id));
