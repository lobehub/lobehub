import { describe, expect, it } from 'vitest';

import { resolveScreenshotSrc } from './screenshotSrc';

describe('resolveScreenshotSrc', () => {
  it('uses the inline capture from the client executor', () => {
    expect(resolveScreenshotSrc({ dataUrl: 'data:image/jpeg;base64,QUJD' })).toBe(
      'data:image/jpeg;base64,QUJD',
    );
  });

  it('uses the stored capture from the server-proxied path', () => {
    expect(resolveScreenshotSrc({ url: 'https://cdn.example.com/s.jpg' })).toBe(
      'https://cdn.example.com/s.jpg',
    );
  });

  it('falls back to the first stored artifact', () => {
    expect(
      resolveScreenshotSrc({
        images: [{ fileId: 'f1', mediaType: 'image/jpeg', url: 'https://cdn.example.com/a.jpg' }],
      }),
    ).toBe('https://cdn.example.com/a.jpg');
  });

  it('resolves nothing when no capture is present', () => {
    expect(resolveScreenshotSrc({ height: 10, width: 10 })).toBeUndefined();
    expect(resolveScreenshotSrc(undefined)).toBeUndefined();
  });
});
