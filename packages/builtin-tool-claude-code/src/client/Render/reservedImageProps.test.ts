import { describe, expect, it } from 'vitest';

import { reservedImageProps } from './reservedImageProps';

describe('reservedImageProps', () => {
  it('reserves the natural size when the image fits under maxHeight', () => {
    expect(reservedImageProps({ height: 400, width: 800 }, 600)).toEqual({
      styles: { image: { aspectRatio: '800 / 400' } },
      width: 800,
    });
  });

  it('scales the width down so a tall capture lands at maxHeight', () => {
    expect(reservedImageProps({ height: 1620, width: 720 }, 600).width).toBe(267);
  });

  it('reserves nothing for older messages without a recorded size', () => {
    expect(reservedImageProps({}, 600)).toEqual({});
    expect(reservedImageProps({ height: 0, width: 800 }, 600)).toEqual({});
  });
});
