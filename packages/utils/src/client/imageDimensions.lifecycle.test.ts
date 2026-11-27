import { afterEach, describe, expect, it, vi } from 'vitest';

import { getImageDimensions } from './imageDimensions';

class PendingImage extends EventTarget {
  naturalHeight = 600;
  naturalWidth = 800;
  src = '';
  removeAttribute() {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image metadata lifecycle', () => {
  it('settles and releases the blob URL when the browser never reports load or error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', PendingImage);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const resolved = vi.fn();
    const pending = getImageDimensions(new File(['image'], 'test.png', { type: 'image/png' })).then(
      resolved,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(resolved).toHaveBeenCalledWith(undefined);
    await pending;
    expect(revoke).toHaveBeenCalledWith('blob:pending');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back when object URL creation is unavailable', async () => {
    vi.stubGlobal('Image', PendingImage);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('unsupported');
    });
    await expect(
      getImageDimensions(new File(['image'], 'test.png', { type: 'image/png' })),
    ).resolves.toBeUndefined();
  });

  it('falls back when Image is absent outside a browser', async () => {
    vi.stubGlobal('Image', undefined);
    await expect(getImageDimensions('data:image/png;base64,AA==')).resolves.toBeUndefined();
  });

  it('clears its timeout and listeners after a successful load', async () => {
    vi.useFakeTimers();
    const image = new PendingImage();
    const remove = vi.spyOn(image, 'removeEventListener');
    vi.stubGlobal('Image', function () {
      return image;
    });
    const pending = getImageDimensions('data:image/png;base64,AA==');
    image.dispatchEvent(new Event('load'));
    await expect(pending).resolves.toEqual({ width: 800, height: 600, ratio: 1.3333 });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('load', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('still settles when blob URL cleanup throws', async () => {
    const image = new PendingImage();
    vi.stubGlobal('Image', function () {
      return image;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken-cleanup');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      throw new Error('cleanup failed');
    });
    const pending = getImageDimensions(new File(['image'], 'test.png', { type: 'image/png' }));
    image.dispatchEvent(new Event('error'));
    await expect(pending).resolves.toBeUndefined();
  });
});
