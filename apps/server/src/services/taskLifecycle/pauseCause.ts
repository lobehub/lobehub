import type { TaskAutomationPauseCause } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

/** Refusals that say the account has no usage left to pay for the run. */
const INSUFFICIENT_BUDGET_ERROR_TYPES = new Set<string>([
  ChatErrorType.FreePlanLimit,
  ChatErrorType.InsufficientBudgetForAgentRunFee,
  ChatErrorType.InsufficientBudgetForModel,
  ChatErrorType.SubscriptionPlanLimit,
]);

export interface RunFailureClassification {
  /** Normalized error category (`ChatMessageError.category`), e.g. `quota`. */
  errorCategory?: string;
  /** Structured error type of the failed run, e.g. `InsufficientBudgetForModel`. */
  errorCode?: string;
}

/**
 * The cause of a failed run that only the account owner can clear, read from
 * the structured error fields, never from the error text.
 *
 * A model the plan does not include is refused with the numeric `Forbidden`
 * type, which other admission gates share; error normalization marks only the
 * plan refusal with the `quota` category (`classifyForbidden`), so the pair
 * identifies it.
 */
export const resolveAutomationPauseCause = ({
  errorCategory,
  errorCode,
}: RunFailureClassification): TaskAutomationPauseCause | undefined => {
  if (!errorCode) return undefined;
  if (INSUFFICIENT_BUDGET_ERROR_TYPES.has(errorCode)) return 'insufficientBudget';
  if (errorCode === String(ChatErrorType.Forbidden) && errorCategory === 'quota')
    return 'paidModelRequired';
  return undefined;
};
