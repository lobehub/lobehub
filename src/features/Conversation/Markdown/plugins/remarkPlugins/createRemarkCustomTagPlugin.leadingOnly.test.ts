import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRemarkCustomTagPlugin } from './createRemarkCustomTagPlugin';

const processor = () =>
  unified()
    .use(remarkParse)
    .use(createRemarkCustomTagPlugin('myTag', { leadingOnly: true }));

const parse = (markdown: string) => processor().parse(markdown);

describe('createRemarkCustomTagPlugin (leadingOnly)', () => {
  let tree: any;

  describe('tag at the very start of the document', () => {
    beforeEach(() => {
      // Blank lines matter: an HTML block swallows content until a blank line, so
      // the real pipeline relies on `normalizeThinkTags` inserting `\n\n` to split
      // the open tag / content / close tag into separate nodes.
      tree = processor().runSync(parse('<myTag>\n\ninner content\n\n</myTag>'));
    });

    it('should collapse into a custom block node', () => {
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].type).toBe('myTagBlock');
      expect(tree.children[0].data.hName).toBe('myTag');
      expect(tree.children[0].data.hChildren[0].value).toContain('inner content');
    });
  });

  describe('tag after other content', () => {
    beforeEach(() => {
      tree = processor().runSync(parse('Intro paragraph.\n\n<myTag>\ninner\n</myTag>'));
    });

    it('should keep the tag as raw html nodes', () => {
      const types = tree.children.map((n: any) => n.type);
      expect(types).toContain('html');
      expect(types).not.toContain('myTagBlock');
    });
  });

  describe('inline tag inside a paragraph', () => {
    beforeEach(() => {
      tree = processor().runSync(parse('Text with <myTag> inline tag stays raw.'));
    });

    it('should not produce a custom block', () => {
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].type).toBe('paragraph');
      const hasHtmlChild = tree.children[0].children.some((c: any) => c.type === 'html');
      expect(hasHtmlChild).toBe(true);
      expect(tree.children.some((n: any) => n.type === 'myTagBlock')).toBe(false);
    });
  });

  describe('no tag at all', () => {
    it('should leave the document untouched', () => {
      const input = '# Heading\n\nJust text.';
      tree = processor().runSync(parse(input));

      expect(tree.children[0].type).toBe('heading');
    });
  });
});
