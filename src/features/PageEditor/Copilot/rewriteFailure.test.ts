import { describe, expect, it } from 'vitest';

import { canRetryRewriteFailure, getRewriteFailureKey } from './rewriteFailure';

describe('rewrite failure presentation policy', () => {
  it.each(['empty', 'truncated'] as const)('uses distinct copy for %s', (reason) => {
    expect(getRewriteFailureKey(`DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:${reason}`)).toBe(
      `copilot.rewrite.failure.${reason}`,
    );
  });
  it('does not offer an ineffective retry for configuration failure or a running attempt', () => {
    expect(
      canRetryRewriteFailure({
        status: 'failed',
        errorCode: 'DOCUMENT_REWRITE_PRODUCTION_CONFIG_ERROR',
      }),
    ).toBe(false);
    expect(
      canRetryRewriteFailure({
        status: 'retry_wait',
        errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:empty',
      }),
    ).toBe(false);
    expect(
      canRetryRewriteFailure({
        status: 'failed',
        errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:empty',
      }),
    ).toBe(true);
  });
});
