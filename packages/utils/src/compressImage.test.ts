import { beforeEach, describe, expect, it, vi } from 'vitest';

import compressImage from './compressImage';

const getContextSpy = vi.spyOn(global.HTMLCanvasElement.prototype, 'getContext');
const drawImageSpy = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');

beforeEach(() => {
  getContextSpy.mockClear();
  drawImageSpy.mockClear();
});

describe('compressImage', () => {
  it('should compress image when width exceeds maxSize', () => {
    const img = document.createElement('img');
    img.width = 3000;
    img.height = 2000;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/png;base64,/);

    expect(getContextSpy).toBeCalledTimes(1);
    expect(getContextSpy).toBeCalledWith('2d');

    expect(drawImageSpy).toBeCalledTimes(1);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 3000, 2000, 0, 0, 1920, 1280);
  });

  it('should compress image when height exceeds maxSize', () => {
    const img = document.createElement('img');
    img.width = 2000;
    img.height = 3000;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/png;base64,/);

    expect(getContextSpy).toBeCalledTimes(1);
    expect(getContextSpy).toBeCalledWith('2d');

    expect(drawImageSpy).toBeCalledTimes(1);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 2000, 3000, 0, 0, 1280, 1920);
  });

  it('should not compress image when within maxSize', () => {
    const img = document.createElement('img');
    img.width = 1800;
    img.height = 1800;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/png;base64,/);

    expect(drawImageSpy).toBeCalledTimes(1);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 1800, 1800, 0, 0, 1800, 1800);
  });

  it('should use specified output type', () => {
    const img = document.createElement('img');
    img.width = 100;
    img.height = 100;

    const r = compressImage({ img, type: 'image/jpeg' });

    expect(r).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('should support custom maxSize', () => {
    const img = document.createElement('img');
    img.width = 500;
    img.height = 300;

    compressImage({ img, maxSize: 400 });

    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 500, 300, 0, 0, 400, 240);
  });
});
