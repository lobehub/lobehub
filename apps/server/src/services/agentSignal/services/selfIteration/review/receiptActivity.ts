import type { AgentSignalReceiptMetadata } from '../../receiptService';

/** How many nightly runs (one per user-local date) the receipt lookback covers. */
export const NIGHTLY_RECEIPT_LOOKBACK_DAYS = 7;

/** One nightly run's receipts, keyed by the user-local date that produced them. */
export interface NightlyReceiptDayPage {
  /** User-local calendar date of the nightly run. */
  localDate: string;
  /** Receipts stored on that run's nightly topic. */
  receipts: { id: string; metadata?: AgentSignalReceiptMetadata }[];
}

/**
 * Resolves the reviewed local date for the nightly receipt lookback.
 *
 * Use when:
 * - A caller did not thread the nightly payload `localDate` into the read adapters
 *
 * Expects:
 * - `reviewWindowEnd` is the exclusive end of the reviewed local day
 *
 * Returns:
 * - The payload `localDate` when present, otherwise the date of the last instant
 *   inside the review window
 */
export const resolveReviewedLocalDate = ({
  localDate,
  reviewWindowEnd,
}: {
  localDate?: string;
  reviewWindowEnd: string;
}) => localDate ?? new Date(new Date(reviewWindowEnd).getTime() - 1).toISOString().slice(0, 10);

/**
 * Lists the user-local dates covered by the nightly receipt lookback.
 *
 * Use when:
 * - Recurring-idea detection needs one nightly topic id per prior run
 *
 * Expects:
 * - `localDate` is the reviewed calendar date, not the review window end. The window
 *   end is the *start* of the current local day, so deriving a date from it would
 *   query a future day that never holds a nightly receipt
 *
 * Returns:
 * - `days` calendar dates ending at `localDate`, newest first
 */
export const listNightlyReceiptLocalDates = ({
  days = NIGHTLY_RECEIPT_LOOKBACK_DAYS,
  localDate,
}: {
  days?: number;
  localDate: string;
}) => {
  const start = new Date(`${localDate}T00:00:00.000Z`);

  return Array.from({ length: days }, (_, offset) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() - offset);

    return day.toISOString().slice(0, 10);
  });
};

const getNormalizedIdeaKey = (idempotencyKey: string) =>
  idempotencyKey
    .replace(/nightly-review:\d{4}-\d{2}-\d{2}:/, 'nightly-review:')
    .replace(/nightly-review:[^:]+:[^:]+:\d{4}-\d{2}-\d{2}:/, 'nightly-review:');

/**
 * Groups recurring self-review ideas across distinct nightly runs.
 *
 * Use when:
 * - Nightly review needs `recurring_review_idea` signals from receipt history
 *
 * Expects:
 * - Each page holds the receipts of exactly one user-local nightly run
 *
 * Returns:
 * - Groups counted by distinct local dates, so several ideas sharing one key inside
 *   a single run never look recurring
 */
export const groupRecurringReviewIdeas = (pages: NightlyReceiptDayPage[]) => {
  const ideaGroups = new Map<string, Map<string, string>>();

  for (const page of pages) {
    for (const receipt of page.receipts) {
      for (const idea of receipt.metadata?.selfIteration?.ideas ?? []) {
        const key = getNormalizedIdeaKey(idea.idempotencyKey);
        const receiptIdByDate = ideaGroups.get(key) ?? new Map<string, string>();

        if (!receiptIdByDate.has(page.localDate)) receiptIdByDate.set(page.localDate, receipt.id);
        ideaGroups.set(key, receiptIdByDate);
      }
    }
  }

  return [...ideaGroups.entries()]
    .filter(([, receiptIdByDate]) => receiptIdByDate.size >= 2)
    .map(([key, receiptIdByDate]) => ({
      count: receiptIdByDate.size,
      key,
      receiptIds: [...receiptIdByDate.values()],
    }));
};
