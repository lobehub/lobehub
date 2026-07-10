import { describe, expect, it } from 'vitest';

import { imageMarkdown, imagePlaceholder, rewriteImagePlaceholders } from './imageEcho';

describe('imageEcho', () => {
  it('placeholder / markdown shapes are stable', () => {
    expect(imagePlaceholder('image/png')).toBe('[Image: image/png]');
    expect(imageMarkdown('image/png', 'https://cdn/x.png')).toBe('![image/png](https://cdn/x.png)');
  });

  describe('rewriteImagePlaceholders', () => {
    it('rewrites a single uploaded image into a markdown image', () => {
      expect(
        rewriteImagePlaceholders('[Image: image/png]', [
          { mediaType: 'image/png', url: 'https://cdn/x.png' },
        ]),
      ).toBe('![image/png](https://cdn/x.png)');
    });

    it('keeps the placeholder when the image failed to upload (no url)', () => {
      expect(rewriteImagePlaceholders('[Image: image/png]', [{ mediaType: 'image/png' }])).toBe(
        '[Image: image/png]',
      );
    });

    it('rewrites only the succeeded images, position-for-position', () => {
      const content = 'before\n[Image: image/png]\nmid\n[Image: image/jpeg]\nafter';
      expect(
        rewriteImagePlaceholders(content, [
          { mediaType: 'image/png', url: 'https://cdn/a.png' },
          { mediaType: 'image/jpeg' }, // failed — keep placeholder
        ]),
      ).toBe('before\n![image/png](https://cdn/a.png)\nmid\n[Image: image/jpeg]\nafter');
    });

    it('preserves surrounding non-image text', () => {
      expect(
        rewriteImagePlaceholders('read the file:\n[Image: image/webp]\ndone', [
          { mediaType: 'image/webp', url: 'https://cdn/w.webp' },
        ]),
      ).toBe('read the file:\n![image/webp](https://cdn/w.webp)\ndone');
    });

    it('bails out unchanged when the placeholder count does not match outcomes', () => {
      // One placeholder but two outcomes → cannot map safely → leave content as-is.
      const content = '[Image: image/png]';
      expect(
        rewriteImagePlaceholders(content, [
          { mediaType: 'image/png', url: 'https://cdn/a.png' },
          { mediaType: 'image/png', url: 'https://cdn/b.png' },
        ]),
      ).toBe(content);
    });

    it('returns content unchanged when there are no placeholders', () => {
      expect(rewriteImagePlaceholders('plain text', [])).toBe('plain text');
    });
  });
});
