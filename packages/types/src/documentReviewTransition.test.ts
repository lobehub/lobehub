import { describe, expect, it } from 'vitest';

import type { DocumentReviewCheckStatus } from './documentReview';
import { DOCUMENT_REVIEW_CHECK_STATUSES } from './documentReview';
import {
  DocumentReviewTransitionError,
  resolveDocumentReviewCheckTransition,
} from './documentReviewTransition';

const resolve = resolveDocumentReviewCheckTransition;

describe('resolveDocumentReviewCheckTransition', () => {
  it('exposes exactly the five check statuses', () => {
    expect([...DOCUMENT_REVIEW_CHECK_STATUSES]).toEqual([
      'passed',
      'failed',
      'uncertain',
      'unchecked',
      'needs_recheck',
    ]);
  });

  describe('apply_suggestion', () => {
    it.each<DocumentReviewCheckStatus>(['failed', 'uncertain', 'needs_recheck'])(
      'moves %s to needs_recheck, never to passed',
      (from) => {
        expect(resolve(from, { event: 'apply_suggestion' })).toBe('needs_recheck');
      },
    );

    it('rejects an apply that tries to carry a passed outcome (apply → passed)', () => {
      expect(() =>
        resolve('failed', { event: 'apply_suggestion', outcome: 'passed' }),
      ).toThrowError(DocumentReviewTransitionError);
      try {
        resolve('failed', { event: 'apply_suggestion', outcome: 'passed' });
      } catch (error) {
        expect((error as DocumentReviewTransitionError).code).toBe('unexpected_outcome');
      }
    });

    it.each<DocumentReviewCheckStatus>(['passed', 'unchecked'])(
      'refuses to apply a suggestion to a %s result',
      (from) => {
        expect(() => resolve(from, { event: 'apply_suggestion' })).toThrowError(
          expect.objectContaining({ code: 'illegal_transition' }),
        );
      },
    );
  });

  describe('check', () => {
    it.each(DOCUMENT_REVIEW_CHECK_STATUSES)('lets a re-check move %s to passed', (from) => {
      expect(resolve(from, { event: 'check', outcome: 'passed' })).toBe('passed');
    });

    it('turns needs_recheck into failed or uncertain when the re-check says so', () => {
      expect(resolve('needs_recheck', { event: 'check', outcome: 'failed' })).toBe('failed');
      expect(resolve('needs_recheck', { event: 'check', outcome: 'uncertain' })).toBe('uncertain');
    });

    it('requires an outcome', () => {
      expect(() => resolve('needs_recheck', { event: 'check' })).toThrowError(
        expect.objectContaining({ code: 'missing_outcome' }),
      );
    });

    it('rejects an outcome that is not a check outcome', () => {
      expect(() =>
        resolve('failed', { event: 'check', outcome: 'needs_recheck' as never }),
      ).toThrowError(expect.objectContaining({ code: 'invalid_event' }));
    });
  });

  it('only a check event can ever produce passed', () => {
    for (const from of DOCUMENT_REVIEW_CHECK_STATUSES) {
      for (const event of ['apply_suggestion', 'invalidate', 'reset'] as const) {
        let next: DocumentReviewCheckStatus | undefined;
        try {
          next = resolve(from, { event });
        } catch {
          next = undefined;
        }
        expect(next).not.toBe('passed');
      }
    }
  });

  it('invalidate marks checked results for re-check and leaves unchecked alone', () => {
    expect(resolve('passed', { event: 'invalidate' })).toBe('needs_recheck');
    expect(resolve('failed', { event: 'invalidate' })).toBe('needs_recheck');
    expect(resolve('uncertain', { event: 'invalidate' })).toBe('needs_recheck');
    expect(resolve('unchecked', { event: 'invalidate' })).toBe('unchecked');
  });

  it('reset returns any status to unchecked', () => {
    for (const from of DOCUMENT_REVIEW_CHECK_STATUSES) {
      expect(resolve(from, { event: 'reset' })).toBe('unchecked');
    }
  });

  it('rejects an unknown event', () => {
    expect(() => resolve('failed', { event: 'approve' as never })).toThrowError(
      expect.objectContaining({ code: 'invalid_event' }),
    );
  });
});
