import type {
  DocumentReviewCheckEvent,
  DocumentReviewCheckOutcome,
  DocumentReviewCheckStatus,
} from './documentReview';
import { DOCUMENT_REVIEW_CHECK_OUTCOMES } from './documentReview';

export type DocumentReviewTransitionErrorCode =
  'invalid_event' | 'missing_outcome' | 'illegal_transition' | 'unexpected_outcome';

/** Thrown when a check result event is not allowed from the current status. */
export class DocumentReviewTransitionError extends Error {
  readonly code: DocumentReviewTransitionErrorCode;
  readonly event: string;
  readonly from: DocumentReviewCheckStatus;

  constructor(
    code: DocumentReviewTransitionErrorCode,
    from: DocumentReviewCheckStatus,
    event: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentReviewTransitionError';
    this.code = code;
    this.event = event;
    this.from = from;
  }
}

export interface DocumentReviewTransitionInput {
  event: DocumentReviewCheckEvent;
  /** Required for `check`; forbidden for every other event. */
  outcome?: DocumentReviewCheckOutcome;
}

/**
 * Statuses from which applying a suggested fix is meaningful. A fix exists only
 * for a rule the check did not pass; `needs_recheck` stays applicable so a user
 * can refine an already applied edit before re-checking.
 */
const APPLICABLE_FROM: ReadonlySet<DocumentReviewCheckStatus> = new Set([
  'failed',
  'uncertain',
  'needs_recheck',
]);

/**
 * Derive the next check status from the current one and an event.
 *
 * Invariants (enforced here and only here, then reused by the server model):
 * 1. `passed` is reachable **only** through a `check` event whose outcome is
 *    `passed`. Applying a fix never verifies it.
 * 2. `apply_suggestion` always lands on `needs_recheck`.
 * 3. `invalidate` turns a previously checked result into `needs_recheck`.
 * 4. `reset` returns any result to `unchecked`.
 */
export const resolveDocumentReviewCheckTransition = (
  from: DocumentReviewCheckStatus,
  input: DocumentReviewTransitionInput,
): DocumentReviewCheckStatus => {
  const { event, outcome } = input;

  if (event !== 'check' && outcome !== undefined) {
    throw new DocumentReviewTransitionError(
      'unexpected_outcome',
      from,
      event,
      `Event "${event}" cannot carry an outcome; only "check" may set "${outcome}"`,
    );
  }

  switch (event) {
    case 'check': {
      if (!outcome) {
        throw new DocumentReviewTransitionError(
          'missing_outcome',
          from,
          event,
          'A check event requires an outcome',
        );
      }
      if (!(DOCUMENT_REVIEW_CHECK_OUTCOMES as readonly string[]).includes(outcome)) {
        throw new DocumentReviewTransitionError(
          'invalid_event',
          from,
          event,
          `Unknown check outcome "${outcome}"`,
        );
      }
      return outcome;
    }

    case 'apply_suggestion': {
      if (!APPLICABLE_FROM.has(from)) {
        throw new DocumentReviewTransitionError(
          'illegal_transition',
          from,
          event,
          `Cannot apply a suggestion to a "${from}" check result`,
        );
      }
      return 'needs_recheck';
    }

    case 'invalidate': {
      // Nothing was verified yet, so there is nothing to invalidate.
      if (from === 'unchecked') return 'unchecked';
      return 'needs_recheck';
    }

    case 'reset': {
      return 'unchecked';
    }

    default: {
      throw new DocumentReviewTransitionError(
        'invalid_event',
        from,
        String(event),
        `Unknown check event "${String(event)}"`,
      );
    }
  }
};
