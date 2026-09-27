import { normalizeHeterogeneousMessageError } from '@lobechat/heterogeneous-agents/errors';
import { normalizeChatMessageError } from '@lobechat/model-runtime/errors';
import type { ChatErrorBudgetContext, ChatMessageError } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { formatPgError, pgErrorType, unwrapPgError } from './pgError';

/** Add server-only database diagnostics before shared message normalization. */
export const formatErrorForState = (error: unknown): ChatMessageError => {
  if (error instanceof Error) {
    const pg = unwrapPgError(error);
    if (pg) {
      return {
        attribution: 'harness',
        body: {
          name: error.name,
          pg,
          wrappedMessage: error.message,
        },
        category: 'stream',
        countAsFailure: true,
        httpStatus: 500,
        message: formatPgError(pg),
        retryable: false,
        severity: 'error',
        type: pgErrorType(pg) as ChatMessageError['type'],
      };
    }
  }
  return normalizeHeterogeneousMessageError(normalizeChatMessageError(error));
};

const readFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Read the structured allowance context a cost-admission gate attached to a
 * rejected run out of an already-normalized error.
 *
 * `buildPayloadBody` copies the throw site's `budget` payload onto `body`
 * verbatim, and `body` is `any` — so narrow it field by field here instead of
 * casting. A field that isn't a finite number / string is dropped rather than
 * forwarded to a renderer that would print `undefined` at the user, and a
 * context with nothing usable left in it collapses to `undefined` so callers
 * can treat "no budget context" and "unusable budget context" the same way.
 */
export const readErrorBudgetContext = (
  error: ChatMessageError | undefined,
): ChatErrorBudgetContext | undefined => {
  const budget = (error?.body as { budget?: unknown } | undefined)?.budget;
  if (!isRecord(budget)) return undefined;

  const context: ChatErrorBudgetContext = {
    availableCredits: readFiniteNumber(budget.availableCredits),
    budgetTypeAtError:
      typeof budget.budgetTypeAtError === 'string' ? budget.budgetTypeAtError : undefined,
    requiredCredits: readFiniteNumber(budget.requiredCredits),
    shortfallCredits: readFiniteNumber(budget.shortfallCredits),
  };

  return Object.values(context).some((value) => value !== undefined) ? context : undefined;
};
