import { describe, expect, it } from 'vitest';

import { DOCUMENT_REWRITE_REVIEW_ONLY_STATUS, DocumentRewriteRequestService } from './index';
import {
  assertDocumentRewriteTransition,
  canRetryDocumentRewrite,
  canTransitionDocumentRewrite,
  DocumentRewriteTransitionError,
  isDocumentRewriteTerminal,
} from './stateMachine';

describe('document rewrite state machine', () => {
  it('allows the ordered direct worker path and legacy review settlement', () => {
    expect(canTransitionDocumentRewrite('queued', 'connecting')).toBe(true);
    expect(canTransitionDocumentRewrite('connecting', 'syncing')).toBe(true);
    expect(canTransitionDocumentRewrite('syncing', 'thinking')).toBe(true);
    expect(canTransitionDocumentRewrite('thinking', 'writing')).toBe(true);
    expect(canTransitionDocumentRewrite('writing', 'applied')).toBe(true);
    expect(canTransitionDocumentRewrite('cancel_requested', 'applied')).toBe(true);
    expect(canTransitionDocumentRewrite('writing', 'awaiting_review')).toBe(true);
    expect(canTransitionDocumentRewrite('awaiting_review', 'applied')).toBe(true);
    expect(canTransitionDocumentRewrite('awaiting_review', 'rejected')).toBe(true);
    expect(canTransitionDocumentRewrite('canceled_after_write', 'applied')).toBe(true);
    expect(canTransitionDocumentRewrite('canceled_after_write', 'rejected')).toBe(true);
    expect(canTransitionDocumentRewrite('applied', 'queued')).toBe(false);
    expect(canTransitionDocumentRewrite('writing', 'queued')).toBe(false);
  });

  it('reports invalid transitions as a typed error', () => {
    expect(() => assertDocumentRewriteTransition('failed', 'writing')).toThrow(
      DocumentRewriteTransitionError,
    );
    expect(() => assertDocumentRewriteTransition('failed', 'writing')).toThrow('failed -> writing');
  });

  it('allows retry only after an explicit terminal failure/cancel outcome', () => {
    expect(canRetryDocumentRewrite('failed')).toBe(true);
    expect(canRetryDocumentRewrite('stale')).toBe(true);
    expect(canRetryDocumentRewrite('canceled')).toBe(true);
    expect(canRetryDocumentRewrite('canceled_after_write')).toBe(false);
    expect(canRetryDocumentRewrite('applied')).toBe(false);
    expect(isDocumentRewriteTerminal('canceled_after_write')).toBe(true);
  });

  it('keeps review settlement on the user-facing API', async () => {
    const service = new DocumentRewriteRequestService(undefined as never, 'user');
    await expect(
      service.transitionWorker('request', {
        attempt: 1,
        status: 'applied',
        workerId: 'worker',
      }),
    ).rejects.toThrow(DOCUMENT_REWRITE_REVIEW_ONLY_STATUS);
  });
});
