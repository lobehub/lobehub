import type { LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import { wrapInlineRootChildren } from './MarkdownRootDocumentPlugin';

// Node classes from another copy of `lexical`, as the server bundle loads them:
// they behave like Lexical's own but do not extend the classes this package imports.
class ForeignElement {
  getChildren() {
    return [];
  }
}
class ForeignDecorator {
  decorate() {
    return null;
  }
}
class ForeignText {}

const editor = {
  _nodes: new Map([
    ['heading', { klass: ForeignElement }],
    ['image', { klass: ForeignDecorator }],
    ['linebreak', { klass: ForeignText }],
    ['paragraph', { klass: ForeignElement }],
    ['text', { klass: ForeignText }],
  ]),
} as unknown as LexicalEditor;

describe('wrapInlineRootChildren', () => {
  it('wraps only the runs Lexical refuses at the root, whichever lexical copy defined them', () => {
    const heading = { type: 'heading' };
    const rawHtml = { text: '<alert type="info">\nShips behind a flag.\n</alert>', type: 'text' };
    const lineBreak = { type: 'linebreak' };
    const trailingText = { text: 'More', type: 'text' };
    const image = { type: 'image' };
    const paragraph = { type: 'paragraph' };
    const unknown = { type: 'mystery' };

    const blocks = wrapInlineRootChildren(editor, [
      heading,
      rawHtml,
      lineBreak,
      trailingText,
      image,
      paragraph,
      unknown,
    ]);

    expect(blocks).toEqual([
      heading,
      expect.objectContaining({ children: [rawHtml, lineBreak, trailingText], type: 'paragraph' }),
      image,
      paragraph,
      unknown,
    ]);
  });
});
