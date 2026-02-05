import { beforeEach, describe, expect, it, vi } from 'vitest';

import compressImage from './compressImage';

const getContextSpy = vi.spyOn(global.HTMLCanvasElement.prototype, 'getContext');
const drawImageSpy = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');

beforeEach(() => {
  getContextSpy.mockClear();
  drawImageSpy.mockClear();
});

describe('compressImage', () => {
  it('should compress image with maxWidth', () => {
    const img = document.createElement('img');
    img.width = 3000;
    img.height = 2000;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/webp;base64,/);

    expect(getContextSpy).toBeCalledTimes(1);
    expect(getContextSpy).toBeCalledWith('2d');

    expect(drawImageSpy).toBeCalledTimes(1);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 3000, 2000, 0, 0, 2160, 1440);
  });

  it('should compress image with maxHeight', () => {
    const img = document.createElement('img');
    img.width = 2000;
    img.height = 3000;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/webp;base64,/);

    expect(getContextSpy).toBeCalledTimes(1);
    expect(getContextSpy).toBeCalledWith('2d');

    expect(drawImageSpy).toBeCalledTimes(1);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 2000, 3000, 0, 0, 1440, 2160);
  });

  it('should not compress image', () => {
    const img = document.createElement('img');
    img.width = 2000;
    img.height = 2000;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/webp;base64,/);

    expect(getContextSpy).toBeCalledTimes(1);
    expect(getContextSpy).toBeCalledWith('2d');

    expect(drawImageSpy).toBeCalledTimes(1);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 2000, 2000, 0, 0, 2000, 2000);
  });
});
