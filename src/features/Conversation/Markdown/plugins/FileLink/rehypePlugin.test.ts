import { describe, expect, it } from 'vitest';

import { LOBE_FILE_LINK_TAG } from './parse';
import { rehypeFileLink } from './rehypePlugin';

const run = (tree: any) => rehypeFileLink()(tree);

const ORIGIN = () => window.location.origin;

describe('rehypeFileLink', () => {
  it('retags an absolute, same-origin file proxy link', () => {
    const href = `${ORIGIN()}/f/file_abc123`;
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href },
          children: [{ type: 'text', value: 'bubble_sort.py' }],
        },
      ],
    };

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe(LOBE_FILE_LINK_TAG);
    expect(node.properties).toEqual({
      fileId: 'file_abc123',
      linkHref: href,
      linkLabel: 'bubble_sort.py',
    });
    expect(node.children).toEqual([]);
  });

  it('retags a relative file proxy link', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: '/f/file_xyz' },
          children: [{ type: 'text', value: 'report.xlsx' }],
        },
      ],
    };

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe(LOBE_FILE_LINK_TAG);
    expect(node.properties.fileId).toBe('file_xyz');
  });

  it('falls back to the file id as label when the link has no text', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'a', properties: { href: '/f/file_xyz' }, children: [] },
      ],
    };

    run(tree);

    expect((tree as any).children[0].properties.linkLabel).toBe('file_xyz');
  });

  it('does not intercept a cross-origin link sharing the same path shape', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'https://example.com/f/not-ours' },
          children: [{ type: 'text', value: 'not-ours' }],
        },
      ],
    };

    run(tree);

    expect((tree as any).children[0].tagName).toBe('a');
  });

  it('leaves a normal external link untouched', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'https://example.com/docs' },
          children: [{ type: 'text', value: 'docs' }],
        },
      ],
    };

    run(tree);

    expect((tree as any).children[0].tagName).toBe('a');
  });

  it('leaves non-anchor elements untouched', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [] }],
    };

    run(tree);

    expect((tree as any).children[0].tagName).toBe('p');
  });
});
