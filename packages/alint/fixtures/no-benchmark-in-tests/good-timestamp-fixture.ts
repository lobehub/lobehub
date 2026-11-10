// Fixture carve-out: a real clock used to build a timestamp, not to measure a duration.
import { describe, expect, it } from 'vitest';

import { buildSession } from '../session';

describe('buildSession', () => {
  it('expires one hour after the session was stamped', () => {
    const now = Date.now();
    const stale = now - 61_000;

    const session = buildSession({ now, previousRefreshedAt: stale });

    expect(session.createdAt).toBe(now);
    expect(session.expiresAt).toBe(now + 3_600_000);
  });
});
