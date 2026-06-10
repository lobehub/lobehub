/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getImageDimensions } from './imageDimensions';

// Mock functions - need to be accessible in tests
const mockAddEventListener = vi.fn();
let mockImage: ReturnType<typeof vi.fn>;
let mockCreateObjectURL: any;
let mockRevokeObjectURL: any;

// Store event handlers for manual triggering
let loadHandler: (() => void) | null = null;
let errorHandler: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  loadHandler = null;
  errorHandler = null;

  // Mock Image constructor using vi.stubGlobal (modern approach)
  const mockImageInstance = {
    addEventListener: mockAddEventListener.mockImplementation(
      (event: string, handler: () => void) => {
        if (event === 'load') loadHandler = handler;
        if (event === 'error') errorHandler = handler;
      },
    ),
    naturalHeight: 600,
    naturalWidth: 800,
    src: '',
  };

  mockImage = vi.fn().mockImplementation(() => mockImageInstance);
  vi.stubGlobal('Image', mockImage);

  // Mock URL methods using vi.spyOn (preserves other URL functionality)
  mockCreateObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  mockRevokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('getImageDimensions', () => {
  it('should return correct dimensions for valid File object', async () => {
    const imageFile = new File(['fake image data'], 'test.png', { type: 'image/png' });

    const resultPromise = getImageDimensions(imageFile);
    loadHandler?.();
    const result = await resultPromise;

    expect(result).toEqual({ height: 600, ratio: 1.3333, width: 800 });
    expect(mockImage).toHaveBeenCalledTimes(1);
    expect(mockCreateObjectURL).toHaveBeenCalledWith(imageFile);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should return correct dimensions for valid data URI', async () => {
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const resultPromise = getImageDimensions(dataUri);
    loadHandler?.();
    const result = await resultPromise;

    expect(result).toEqual({ height: 600, ratio: 1.3333, width: 800 });
    expect(mockImage).toHaveBeenCalledTimes(1);
    // Data URI should not use createObjectURL
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(mockRevokeObjectURL).not.toHaveBeenCalled();
  });

  it('should return undefined for invalid inputs', async () => {
    // Test non-image file
    const textFile = new File(['content'], 'test.txt', { type: 'text/plain' });
    const result1 = await getImageDimensions(textFile);
    expect(result1).toBeUndefined();

    // Test non-data URI string
    const result2 = await getImageDimensions('https://example.com/image.jpg');
    expect(result2).toBeUndefined();
  });

  it('should return undefined when image fails to load', async () => {
    const imageFile = new File(['fake image data'], 'test.png', { type: 'image/png' });

    const resultPromise = getImageDimensions(imageFile);
    errorHandler?.(); // Simulate load error
    const result = await resultPromise;

    expect(result).toBeUndefined();
    expect(mockCreateObjectURL).toHaveBeenCalledWith(imageFile);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
