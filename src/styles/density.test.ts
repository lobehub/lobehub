import { describe, expect, it } from 'vitest';

import { DENSITY_TOKENS } from './density';

describe('DENSITY_TOKENS', () => {
  it('uses 32px rows in compact', () => {
    expect(DENSITY_TOKENS.compact).toMatchObject({
      fontSize: 13,
      headerAvatarSize: 24,
      headerHeight: 40,
      iconSize: 16,
      rowHeight: 32,
    });
  });

  it('keeps the current header action sizes in loose', () => {
    expect(DENSITY_TOKENS.loose.headerActionSize).toEqual({ blockSize: 32, size: 20 });
    expect(DENSITY_TOKENS.loose.headerActionSmallSize).toEqual({ blockSize: 28, size: 16 });
  });

  it('sizes tree rows from the control height', () => {
    expect(DENSITY_TOKENS.compact.treeItemHeight).toBe(28);
    expect(DENSITY_TOKENS.loose.treeItemHeight).toBe(32);
  });

  it('uses 36px rows in loose', () => {
    expect(DENSITY_TOKENS.loose).toMatchObject({ fontSize: 14, iconSize: 18, rowHeight: 36 });
  });
});
