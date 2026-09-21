import { describe, expect, it } from 'vitest';

import { rasterDimensions } from './rasterDimensions';

describe('rasterDimensions', () => {
  it('reads PNG dimensions used to reserve Acceptance evidence height', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);

    expect(rasterDimensions(png)).toEqual({ height: 1080, width: 1920 });
  });

  it('ignores non-image content', () => {
    expect(rasterDimensions(Buffer.from('acceptance report'))).toBeUndefined();
  });
});
