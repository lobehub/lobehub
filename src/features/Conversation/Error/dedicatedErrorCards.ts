import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

/**
 * Error types that `ErrorMessageExtra` renders with a dedicated card instead of the
 * generic message / trace-id fallback. The renderer's switch is type-checked against
 * this list in both directions, so a new dedicated card must be added here.
 *
 * Business overrides can key a `Record<DedicatedErrorCardType, ...>` off this list to
 * make an explicit per-type decision; a new entry then fails their type check until
 * they decide how to handle it.
 */
export const DEDICATED_ERROR_CARD_TYPES = [
  ChatErrorType.FreePlanLimit,
  ChatErrorType.SubscriptionPlanLimit,
  ChatErrorType.InsufficientBudgetForModel,
  ChatErrorType.LobeHubModelDeprecated,
  AgentRuntimeErrorType.QuotaLimitReached,
  AgentRuntimeErrorType.RateLimitExceeded,
  AgentRuntimeErrorType.OllamaServiceUnavailable,
  AgentRuntimeErrorType.OllamaBizError,
  AgentRuntimeErrorType.ExceededContextWindow,
  AgentRuntimeErrorType.NoOpenAIAPIKey,
] as const;

export type DedicatedErrorCardType = (typeof DEDICATED_ERROR_CARD_TYPES)[number];

const DEDICATED_ERROR_CARD_TYPE_SET = new Set<unknown>(DEDICATED_ERROR_CARD_TYPES);

export const isDedicatedErrorCardType = (type: unknown): type is DedicatedErrorCardType =>
  DEDICATED_ERROR_CARD_TYPE_SET.has(type);
