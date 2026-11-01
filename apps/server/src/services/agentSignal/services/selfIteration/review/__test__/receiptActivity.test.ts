// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { AgentSignalReceiptMetadata } from '../../../receiptService';
import { Risk } from '../../types';
import type { NightlyReceiptDayPage } from '../receiptActivity';
import { groupRecurringReviewIdeas, listNightlyReceiptLocalDates } from '../receiptActivity';

const ideaMetadata = (idempotencyKeys: string[]): AgentSignalReceiptMetadata => ({
  selfIteration: {
    ideas: idempotencyKeys.map((idempotencyKey) => ({
      evidenceRefs: [],
      idempotencyKey,
      rationale: 'Keep deck exports reusable.',
      risk: Risk.Low,
    })),
    mode: 'review',
    sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
  },
});

describe('listNightlyReceiptLocalDates', () => {
  /**
   * @example
   * listNightlyReceiptLocalDates({ localDate: '2026-05-04' })[0] is '2026-05-04'.
   */
  it('starts at the reviewed local date instead of the review window end', () => {
    expect(listNightlyReceiptLocalDates({ localDate: '2026-05-04' })).toEqual([
      '2026-05-04',
      '2026-05-03',
      '2026-05-02',
      '2026-05-01',
      '2026-04-30',
      '2026-04-29',
      '2026-04-28',
    ]);
  });
});

describe('groupRecurringReviewIdeas', () => {
  const pageFor = (localDate: string, receipts: NightlyReceiptDayPage['receipts']) => ({
    localDate,
    receipts,
  });

  /**
   * @example
   * groupRecurringReviewIdeas(pages) returns [] for one nightly run.
   */
  it('does not treat repeated ideas inside one nightly run as recurring', () => {
    const pages = [
      pageFor('2026-05-04', [
        {
          id: 'receipt-1',
          metadata: ideaMetadata([
            'nightly-review:user-1:agent-1:2026-05-04:create_skill:skill:deck',
            'nightly-review:user-1:agent-1:2026-05-04:create_skill:skill:deck',
          ]),
        },
        {
          id: 'receipt-2',
          metadata: ideaMetadata([
            'nightly-review:user-1:agent-1:2026-05-04:create_skill:skill:deck',
          ]),
        },
      ]),
    ];

    expect(groupRecurringReviewIdeas(pages)).toEqual([]);
  });

  /**
   * @example
   * groupRecurringReviewIdeas(pages) returns [{ count: 2 }] across two nights.
   */
  it('counts one matching idea per distinct nightly run', () => {
    const pages = [
      pageFor('2026-05-04', [
        {
          id: 'receipt-1',
          metadata: ideaMetadata([
            'nightly-review:user-1:agent-1:2026-05-04:create_skill:skill:deck',
            'nightly-review:user-1:agent-1:2026-05-04:create_skill:skill:deck',
          ]),
        },
      ]),
      pageFor('2026-05-03', [
        {
          id: 'receipt-2',
          metadata: ideaMetadata([
            'nightly-review:user-1:agent-1:2026-05-03:create_skill:skill:deck',
          ]),
        },
      ]),
    ];

    expect(groupRecurringReviewIdeas(pages)).toEqual([
      {
        count: 2,
        key: 'nightly-review:create_skill:skill:deck',
        receiptIds: ['receipt-1', 'receipt-2'],
      },
    ]);
  });
});
