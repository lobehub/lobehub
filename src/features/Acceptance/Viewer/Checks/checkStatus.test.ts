import { Scale, XCircle } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { checkHeadMeta } from './checkStatus';
import type { AcceptanceCheck } from './types';

const failedCheck = (metadata: unknown) =>
  ({
    result: { metadata },
    reviews: [],
    state: 'failed',
    userReview: null,
  }) as unknown as AcceptanceCheck;

describe('checkHeadMeta', () => {
  it('shows a waived mark instead of a failure when a dispute was upheld', () => {
    const waived = failedCheck({
      dispute: {
        arbitration: { decidedAt: '2026-10-01T00:00:00.000Z', outcome: 'upheld', votes: [] },
        filedAt: '2026-10-01T00:00:00.000Z',
        kind: 'invalid_criterion',
        reason: 'Out of scope',
      },
    });
    expect(checkHeadMeta(waived).icon).toBe(Scale);
  });

  it('keeps the failed mark when the dispute was overruled or never arbitrated', () => {
    const overruled = failedCheck({
      dispute: {
        arbitration: { decidedAt: '2026-10-01T00:00:00.000Z', outcome: 'overruled', votes: [] },
        filedAt: '2026-10-01T00:00:00.000Z',
        kind: 'invalid_criterion',
        reason: 'Out of scope',
      },
    });
    expect(checkHeadMeta(overruled).icon).toBe(XCircle);
    expect(checkHeadMeta(failedCheck(undefined)).icon).toBe(XCircle);
  });
});
