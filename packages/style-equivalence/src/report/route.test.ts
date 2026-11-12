import { describe, expect, it } from 'vitest';

import { hrefOf, parseRoute } from './route';

describe('route', () => {
  it('keeps the anchor of a method page link', () => {
    expect(parseRoute('#/method#CROSS_COMPONENT')).toEqual({
      anchor: 'CROSS_COMPONENT',
      kind: 'method',
    });
    expect(parseRoute('#/method')).toEqual({ kind: 'method' });
    expect(hrefOf({ anchor: 'border', kind: 'method' })).toBe('#/method#border');
  });

  it('opens one review item by its key', () => {
    const key = 'src/A.tsx|A#0';
    expect(hrefOf({ key, kind: 'review' })).toBe(`#/review/${encodeURIComponent(key)}`);
    expect(parseRoute(hrefOf({ key, kind: 'review' }))).toEqual({ key, kind: 'review' });
    expect(parseRoute('#/review')).toEqual({ kind: 'review' });
  });
});
