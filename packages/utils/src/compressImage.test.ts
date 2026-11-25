import { beforeEach, describe, expect, it, vi } from 'vitest';

import compressImage, {
  COMPRESSIBLE_IMAGE_TYPES,
  compressImageFile,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIZE,
  WEBP_MIN_BYTES,
} from './compressImage';

const getContextSpy = vi.spyOn(global.HTMLCanvasElement.prototype, 'getContext');
const drawImageSpy = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
const toDataURLSpy = vi.spyOn(global.HTMLCanvasElement.prototype, 'toDataURL');

beforeEach(() => {
  getContextSpy.mockClear();
  drawImageSpy.mockClear();
  toDataURLSpy.mockClear();
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

  it('should encode JPEG inputs as JPEG with 0.85 quality (preserve format, lossy)', () => {
    const img = document.createElement('img');
    img.width = 100;
    img.height = 100;

    compressImage({ img, type: 'image/jpeg' });

    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.85);
  });

  it('should encode non-JPEG inputs as PNG without a quality argument (lossless)', () => {
    const img = document.createElement('img');
    img.width = 100;
    img.height = 100;

    compressImage({ img, type: 'image/png' });

    expect(toDataURLSpy).toHaveBeenCalledWith('image/png');
  });

  it('should default to PNG when no type is provided', () => {
    const img = document.createElement('img');
    img.width = 100;
    img.height = 100;

    compressImage({ img });

    expect(toDataURLSpy).toHaveBeenCalledWith('image/png');
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

  it('MAX_IMAGE_BYTES should be 3MB (binary cap so base64 stays ~4MB, well under 5MB)', () => {
    expect(MAX_IMAGE_BYTES).toBe(3 * 1024 * 1024);
  });
});

describe('compressImageFile', () => {
  const createMockFile = (name: string, type: string, size: number) => {
    const content = new Uint8Array(size);
    return new File([content], name, { type });
  };

  const mockImageLoad = (width: number, height: number) => {
    const originalImage = global.Image;
    global.Image = class MockImage extends originalImage {
      constructor() {
        super();
        Object.defineProperty(this, 'width', { value: width, writable: false });
        Object.defineProperty(this, 'height', { value: height, writable: false });
        setTimeout(() => this.dispatchEvent(new Event('load')), 0);
      }
    } as any;

    return () => {
      global.Image = originalImage;
    };
  };

  it('should skip compression for small images', async () => {
    const file = createMockFile('small.png', 'image/png', 1000);

    const restoreImage = mockImageLoad(800, 600);

    const result = await compressImageFile(file);

    expect(result).toBe(file); // same reference, no compression
    restoreImage();
  });

  it('should correct MIME type for small images when declared type does not match bytes', async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89,
    ]);
    const file = new File([pngBytes], 'mislabelled.jpg', { type: 'image/jpeg' });

    const restoreImage = mockImageLoad(800, 600);

    const result = await compressImageFile(file);

    expect(result).not.toBe(file);
    expect(result.type).toBe('image/png');
    expect(result.name).toBe('mislabelled.jpg');
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([...pngBytes]);
    restoreImage();
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

  it('should preserve JPEG type when compressing large JPEG inputs (no PNG re-encoding)', async () => {
    const file = createMockFile('photo.jpg', 'image/jpeg', 1000);

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
    // Output File MIME type must match the source format — previously this
    // was hardcoded to 'image/png', which inflated photographic JPEGs.
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.85);
    global.Image = originalImage;
  });

  it('should preserve WebP inputs as PNG (existing fallback behaviour)', async () => {
    const file = createMockFile('photo.webp', 'image/webp', 1000);

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
    // WebP isn't supported as a canvas output target, so we still fall back
    // to lossless PNG. Documents the deliberate choice.
    expect(result.type).toBe('image/png');
    global.Image = originalImage;
  });

  it('should encode through async toBlob instead of blocking on toDataURL', async () => {
    const file = createMockFile('screenshot.png', 'image/png', 1000);
    const encoded = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => setTimeout(() => callback(encoded), 0));
    const restoreImage = mockImageLoad(3000, 2000);

    try {
      const result = await compressImageFile(file);

      expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
      expect(toDataURLSpy).not.toHaveBeenCalled();
      expect(result.name).toBe('screenshot.png');
      expect(result.type).toBe('image/png');
      expect(result.size).toBe(10);
    } finally {
      toBlobSpy.mockRestore();
      restoreImage();
    }
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

  describe('webp', () => {
    const mockToBlob = (type: string, size: number) =>
      vi
        .spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback) =>
          setTimeout(() => callback(new Blob([new Uint8Array(size)], { type })), 0),
        );

    it('should re-encode a heavy screenshot as WebP and rename it', async () => {
      const file = createMockFile('image.png', 'image/png', 1024 * 1024);
      const toBlobSpy = mockToBlob('image/webp', 100);
      const restoreImage = mockImageLoad(1200, 800);

      try {
        const result = await compressImageFile(file, { webp: true });

        expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9);
        expect(result.type).toBe('image/webp');
        expect(result.name).toBe('image.webp');
        expect(result.size).toBe(100);
      } finally {
        toBlobSpy.mockRestore();
        restoreImage();
      }
    });

    it('should leave small images alone rather than re-encode them', async () => {
      const file = createMockFile('icon.png', 'image/png', WEBP_MIN_BYTES);
      const toBlobSpy = mockToBlob('image/webp', 100);
      const restoreImage = mockImageLoad(64, 64);

      try {
        expect(await compressImageFile(file, { webp: true })).toBe(file);
        expect(toBlobSpy).not.toHaveBeenCalled();
      } finally {
        toBlobSpy.mockRestore();
        restoreImage();
      }
    });

    it('should keep the original when WebP comes out larger', async () => {
      const file = createMockFile('flat.png', 'image/png', 300 * 1024);
      const toBlobSpy = mockToBlob('image/webp', 400 * 1024);
      const restoreImage = mockImageLoad(1200, 800);

      try {
        expect(await compressImageFile(file, { webp: true })).toBe(file);
      } finally {
        toBlobSpy.mockRestore();
        restoreImage();
      }
    });

    it('should fall back to the PNG path when the browser cannot encode WebP', async () => {
      const file = createMockFile('large.png', 'image/png', 1000);
      // Browsers without a WebP encoder hand back PNG instead.
      const toBlobSpy = mockToBlob('image/png', 100);
      const restoreImage = mockImageLoad(3000, 2000);

      try {
        const result = await compressImageFile(file, { webp: true });

        expect(toBlobSpy).toHaveBeenLastCalledWith(expect.any(Function), 'image/png', undefined);
        expect(result.type).toBe('image/png');
        expect(result.name).toBe('large.png');
      } finally {
        toBlobSpy.mockRestore();
        restoreImage();
      }
    });
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

  it('should resolve original file when MIME correction fails after image load', async () => {
    const file = createMockFile('broken-buffer.png', 'image/png', 1000);
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Failed to read file'));

    const restoreImage = mockImageLoad(800, 600);

    const result = await compressImageFile(file);

    expect(result).toBe(file);
    restoreImage();
  });
});
