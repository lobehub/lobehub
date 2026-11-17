import { describe, expect, it } from 'vitest';

import { getSiteDetection } from './siteDetection';

describe('getSiteDetection', () => {
  it('waits while the script has never reported in', () => {
    expect(getSiteDetection(null)).toEqual({ state: 'waiting' });
    expect(getSiteDetection(undefined)).toEqual({ state: 'waiting' });
  });

  it('reports when the script was last seen', () => {
    const at = new Date('2026-11-01T08:00:00Z');
    expect(getSiteDetection(at)).toEqual({ at, state: 'seen' });
  });

  it('accepts the timestamp as a serialized string', () => {
    expect(getSiteDetection('2026-11-01T08:00:00.000Z')).toEqual({
      at: new Date('2026-11-01T08:00:00Z'),
      state: 'seen',
    });
  });
});
