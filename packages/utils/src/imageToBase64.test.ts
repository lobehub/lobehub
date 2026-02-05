import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageToBase64, imageUrlToBase64 } from './imageToBase64';

describe('imageToBase64', () => {
  let mockImage: HTMLImageElement;
  let mockCanvas: HTMLCanvasElement;
  let mockContext: CanvasRenderingContext2D;

  beforeEach(() => {
    mockImage = {
      width: 200,
      height: 100,
    } as HTMLImageElement;

    mockContext = {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(mockContext),
      toDataURL: vi.fn().mockReturnValue('data:image/webp;base64,mockBase64Data'),
    } as unknown as HTMLCanvasElement;

    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should convert image to base64 with correct size and type', () => {
    const result = imageToBase64({ img: mockImage, size: 100, type: 'image/jpeg' });

    expect(document.createElement).toHaveBeenCalledWith('canvas');
    expect(mockCanvas.width).toBe(100);
    expect(mockCanvas.height).toBe(100);
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    expect(mockContext.drawImage).toHaveBeenCalledWith(mockImage, 50, 0, 100, 100, 0, 0, 100, 100);
    expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/jpeg');
    expect(result).toBe('data:image/webp;base64,mockBase64Data');
  });

  it('should use default type when not specified', () => {
    imageToBase64({ img: mockImage, size: 100 });
    expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/webp');
  });

  it('should handle taller images correctly', () => {
    mockImage.width = 100;
    mockImage.height = 200;
    imageToBase64({ img: mockImage, size: 100 });
    expect(mockContext.drawImage).toHaveBeenCalledWith(mockImage, 0, 50, 100, 100, 0, 0, 100, 100);
  });
});

describe('imageUrlToBase64', () => {
  const mockFetch = vi.fn();
  const mockArrayBuffer = new ArrayBuffer(8);

  beforeEach(() => {
    global.fetch = mockFetch;
    global.btoa = vi.fn().mockReturnValue('mockBase64String');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should convert image URL to base64 string', async () => {
    mockFetch.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      blob: () => Promise.resolve(new Blob([mockArrayBuffer], { type: 'image/jpg' })),
    });

    const result = await imageUrlToBase64('https://example.com/image.jpg');

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
    expect(global.btoa).toHaveBeenCalled();
    expect(result).toEqual({ base64: 'mockBase64String', mimeType: 'image/jpg' });
  });

  it('should throw an error when fetch fails', async () => {
    const mockError = new Error('Fetch failed');
    mockFetch.mockRejectedValue(mockError);

    await expect(imageUrlToBase64('https://example.com/image.jpg')).rejects.toThrow('Fetch failed');
  });
});
