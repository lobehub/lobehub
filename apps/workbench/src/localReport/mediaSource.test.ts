import { describe, expect, it } from 'vitest';

import { mediaSource } from './mediaSource';

describe('local report media', () => {
  it.each([
    'round/assets/screen%20one.png',
    './截图.png',
    '../assets/clip.mp4',
    'data:image/png;base64,AA==',
    'blob:null/123',
  ])('keeps an adjacent or embedded asset: %s', (src) =>
    expect(mediaSource(src)).toEqual({ type: 'local', url: src }),
  );

  it.each([
    ['https://example.com/image.png', 'https://example.com/image.png'],
    ['//example.com/image.png', 'https://example.com/image.png'],
    ['\\\\example.com/video.mp4', 'https://example.com/video.mp4'],
    [' ht\ntps://example.com/image.png ', 'https://example.com/image.png'],
    ['https://local-report.invalid/image.png', 'https://local-report.invalid/image.png'],
  ])('makes a remote source explicit, never loadable: %s', (src, url) => {
    expect(mediaSource(src)).toEqual({ type: 'external', url });
  });

  it.each([
    undefined,
    '',
    ' ',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'file://host/share/image.png',
    '/absolute/image.png',
    'https://[invalid',
  ])('does not turn missing, invalid or executable sources into links: %s', (src) =>
    expect(mediaSource(src)).toEqual({ type: 'unavailable' }),
  );
});
