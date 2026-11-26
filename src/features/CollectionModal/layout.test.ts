import { describe, expect, it } from 'vitest';

import { getCollectionModalWidth } from './layout';

describe('getCollectionModalWidth', () => {
  it('fits the modal to a small collection', () => {
    expect(getCollectionModalWidth(1)).toBe('min(95vw, 460px)');
    expect(getCollectionModalWidth(2)).toBe('min(95vw, 460px)');
  });

  it('caps at four columns, the width used when the count is unknown', () => {
    expect(getCollectionModalWidth(12)).toBe('min(95vw, 884px)');
    expect(getCollectionModalWidth()).toBe('min(95vw, 884px)');
  });
});
