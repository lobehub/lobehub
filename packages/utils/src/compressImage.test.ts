import { beforeEach, describe, expect, it, vi } from 'vitest';

import compressImage, {
  COMPRESSIBLE_IMAGE_TYPES,
  compressImageFile,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIZE,
} from './compressImage';

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
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 3000, 2000, 0, 0, 1920, 1280);
  });

  it('should compress image when height exceeds maxSize', () => {
    const img = document.createElement('img');
    img.width = 2000;
    img.height = 3000;

    const r = compressImage({ img });

    expect(r).toMatch(/^data:image\/png;base64,/);
    expect(drawImageSpy).toBeCalledWith(img, 0, 0, 2000, 3000, 0, 0, 1280, 1920);
  });

  it('should not compress image when within maxSize', () => {
    const img = document.createElement('img');
    img.width = 1800;
    img.height = 1800;

    compressImage({ img });

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

describe('COMPRESSIBLE_IMAGE_TYPES', () => {
  it('should include jpeg, png, webp', () => {
    expect(COMPRESSIBLE_IMAGE_TYPES.has('image/jpeg')).toBe(true);
    expect(COMPRESSIBLE_IMAGE_TYPES.has('image/png')).toBe(true);
    expect(COMPRESSIBLE_IMAGE_TYPES.has('image/webp')).toBe(true);
  });

  it('should exclude gif and svg', () => {
    expect(COMPRESSIBLE_IMAGE_TYPES.has('image/gif')).toBe(false);
    expect(COMPRESSIBLE_IMAGE_TYPES.has('image/svg+xml')).toBe(false);
  });
});

describe('constants', () => {
  it('MAX_IMAGE_SIZE should be 1920', () => {
    expect(MAX_IMAGE_SIZE).toBe(1920);
  });

  it('MAX_IMAGE_BYTES should be 5MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('compressImageFile', () => {
  const createMockFile = (name: string, type: string, size: number) => {
    const content = new Uint8Array(size);
    return new File([content], name, { type });
  };

  it('should skip compression for small images', async () => {
    const file = createMockFile('small.png', 'image/png', 1000);

    // Mock Image load with small dimensions
    const originalImage = global.Image;
    global.Image = class MockImage extends originalImage {
      constructor() {
        super();
        Object.defineProperty(this, 'width', { value: 800, writable: false });
        Object.defineProperty(this, 'height', { value: 600, writable: false });
        setTimeout(() => this.dispatchEvent(new Event('load')), 0);
      }
    } as any;

    const result = await compressImageFile(file);

    expect(result).toBe(file); // same reference, no compression
    global.Image = originalImage;
  });

  it('should compress images exceeding max dimensions', async () => {
    const file = createMockFile('large.png', 'image/png', 1000);

    const originalImage = global.Image;
    global.Image = class MockImage extends originalImage {
      constructor() {
        super();
        Object.defineProperty(this, 'width', { value: 3000, writable: false });
        Object.defineProperty(this, 'height', { value: 2000, writable: false });
        setTimeout(() => this.dispatchEvent(new Event('load')), 0);
      }
    } as any;

    const result = await compressImageFile(file);

    expect(result).not.toBe(file);
    expect(result.type).toBe('image/png');
    expect(result.name).toBe('large.png');
    global.Image = originalImage;
  });

  it('should compress images exceeding max file size even if dimensions are small', async () => {
    const file = createMockFile('heavy.png', 'image/png', 6 * 1024 * 1024);

    const originalImage = global.Image;
    global.Image = class MockImage extends originalImage {
      constructor() {
        super();
        Object.defineProperty(this, 'width', { value: 1800, writable: false });
        Object.defineProperty(this, 'height', { value: 1800, writable: false });
        setTimeout(() => this.dispatchEvent(new Event('load')), 0);
      }
    } as any;

    const result = await compressImageFile(file);

    expect(result).not.toBe(file);
    expect(result.type).toBe('image/png');
    global.Image = originalImage;
  });

  it('should resolve original file on load error', async () => {
    const file = createMockFile('broken.png', 'image/png', 1000);

    const originalImage = global.Image;
    global.Image = class MockImage extends originalImage {
      constructor() {
        super();
        setTimeout(() => this.dispatchEvent(new Event('error')), 0);
      }
    } as any;

    const result = await compressImageFile(file);

    expect(result).toBe(file);
    global.Image = originalImage;
  });
});
