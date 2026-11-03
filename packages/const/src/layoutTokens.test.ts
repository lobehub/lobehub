import { describe, expect, it } from 'vitest';

import { HEADER_ICON_SIZE } from './layoutTokens';

describe('HEADER_ICON_SIZE', () => {
  it('mobile', () => {
    expect(HEADER_ICON_SIZE(true)).toEqual({ blockSize: 36, size: 22 });
  });

  it('desktop', () => {
    expect(HEADER_ICON_SIZE(false)).toEqual({ blockSize: 32, size: 20 });
  });
});
