import { describe, expect, it } from 'vitest';

import { preserveSkippedIntervention } from './interventionAck';

describe('preserveSkippedIntervention', () => {
  it('keeps an explicit local skip after the producer acknowledges user cancellation', () => {
    const incoming = { rejectedReason: 'user_cancelled', status: 'rejected' as const };
    expect(preserveSkippedIntervention(incoming, { skipped: true, status: 'rejected' })).toEqual({
      ...incoming,
      skipped: true,
    });
    expect(incoming).not.toHaveProperty('skipped');
  });

  it('keeps a cancelled action distinct from a skipped action', () => {
    const incoming = { rejectedReason: 'user_cancelled', status: 'rejected' as const };
    expect(preserveSkippedIntervention(incoming, { skipped: false, status: 'rejected' })).toBe(
      incoming,
    );
    expect(preserveSkippedIntervention(incoming)).toBe(incoming);
  });

  it.each([
    { status: 'approved' as const },
    { rejectedReason: 'timeout', status: 'rejected' as const },
    { rejectedReason: 'session_ended', status: 'aborted' as const },
  ])('does not carry a skip into a different terminal outcome: $status', (incoming) => {
    expect(preserveSkippedIntervention(incoming, { skipped: true, status: 'rejected' })).toBe(
      incoming,
    );
  });
});
