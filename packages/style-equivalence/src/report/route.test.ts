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
});
