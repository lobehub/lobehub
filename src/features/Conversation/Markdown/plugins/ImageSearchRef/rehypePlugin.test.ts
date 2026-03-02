import { describe, expect, it } from 'vitest';

import { IMAGE_SEARCH_REF_TAG, rehypeImageSearchRef } from './rehypePlugin';

const run = (tree: any) => rehypeImageSearchRef()(tree);

describe('rehypeImageSearchRef', () => {
  describe('basic replacement', () => {
    it('should replace a lone image_0.png text node with a custom element', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'image_0.png' }],
          },
        ],
      };

      run(tree);

      const p = (tree as any).children[0];
      expect(p.children).toHaveLength(1);
      expect(p.children[0]).toMatchObject({
        type: 'element',
        tagName: IMAGE_SEARCH_REF_TAG,
        properties: { imageIndex: 0, originalText: 'image_0.png' },
        children: [{ type: 'text', value: 'image_0.png' }],
      });
    });

    it('should preserve text before and after the reference', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'See image_3.jpg for details.' }],
          },
        ],
      };

      run(tree);

      const children = (tree as any).children[0].children;
      expect(children).toHaveLength(3);
      expect(children[0]).toEqual({ type: 'text', value: 'See ' });
      expect(children[1]).toMatchObject({
        type: 'element',
        tagName: IMAGE_SEARCH_REF_TAG,
        properties: { imageIndex: 3, originalText: 'image_3.jpg' },
      });
      expect(children[2]).toEqual({ type: 'text', value: ' for details.' });
    });

    it('should handle multiple references in a single text node', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'image_0.png and image_1.webp' }],
          },
        ],
      };

      run(tree);

      const children = (tree as any).children[0].children;
      expect(children).toHaveLength(3);
      expect(children[0]).toMatchObject({
        tagName: IMAGE_SEARCH_REF_TAG,
        properties: { imageIndex: 0, originalText: 'image_0.png' },
      });
      expect(children[1]).toEqual({ type: 'text', value: ' and ' });
      expect(children[2]).toMatchObject({
        tagName: IMAGE_SEARCH_REF_TAG,
        properties: { imageIndex: 1, originalText: 'image_1.webp' },
      });
    });
  });

  describe('supported extensions', () => {
    it.each(['png', 'jpg', 'jpeg', 'gif', 'webp'])('should match image_0.%s', (ext) => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: `image_0.${ext}` }],
          },
        ],
      };

      run(tree);

      const children = (tree as any).children[0].children;
      expect(children[0]).toMatchObject({
        type: 'element',
        tagName: IMAGE_SEARCH_REF_TAG,
        properties: { imageIndex: 0, originalText: `image_0.${ext}` },
      });
    });
  });

  describe('word boundary enforcement', () => {
    it('should NOT match when prefix is attached (myimage_0.png)', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'myimage_0.png' }],
          },
        ],
      };

      run(tree);

      // No replacement — original text node stays
      const children = (tree as any).children[0].children;
      expect(children).toHaveLength(1);
      expect(children[0]).toEqual({ type: 'text', value: 'myimage_0.png' });
    });

    it('should NOT match when suffix is attached (image_0.pngfile)', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'image_0.pngfile' }],
          },
        ],
      };

      run(tree);

      const children = (tree as any).children[0].children;
      expect(children).toHaveLength(1);
      expect(children[0]).toEqual({ type: 'text', value: 'image_0.pngfile' });
    });
  });

  describe('no-op cases', () => {
    it('should leave text nodes without image references unchanged', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'No references here.' }],
          },
        ],
      };

      run(tree);

      const children = (tree as any).children[0].children;
      expect(children).toHaveLength(1);
      expect(children[0]).toEqual({ type: 'text', value: 'No references here.' });
    });

    it('should handle multi-digit indices correctly', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'image_42.gif' }],
          },
        ],
      };

      run(tree);

      const children = (tree as any).children[0].children;
      expect(children[0]).toMatchObject({
        properties: { imageIndex: 42, originalText: 'image_42.gif' },
      });
    });
  });
});
