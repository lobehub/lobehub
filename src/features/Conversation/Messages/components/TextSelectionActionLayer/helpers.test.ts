import { describe, expect, it } from 'vitest';

import {
  createTextSelectionContext,
  getSelectionPreview,
  getSelectionToolbarPosition,
  isSameTextSelectionContext,
} from './helpers';

describe('TextSelectionActionLayer helpers', () => {
  it('builds a text context selection from selected rendered text', () => {
    const context = createTextSelectionContext({
      id: 'selection-1',
      selectedText: '  selected\ntext  ',
      title: 'Message selection',
    });

    expect(context).toEqual({
      content: 'selected\ntext',
      format: 'text',
      id: 'selection-1',
      preview: 'selected text',
      source: 'text',
      title: 'Message selection',
      type: 'text',
    });
  });

  it('dedupes only plain text selections with the same content', () => {
    const textContext = createTextSelectionContext({
      id: 'selection-1',
      selectedText: 'selected text',
      title: 'Message selection',
    });

    expect(isSameTextSelectionContext(textContext, ' selected text ')).toBe(true);
    expect(
      isSameTextSelectionContext({ ...textContext, filePath: 'src/a.ts' }, 'selected text'),
    ).toBe(false);
    expect(isSameTextSelectionContext({ ...textContext, pageId: 'page-1' }, 'selected text')).toBe(
      false,
    );
  });

  it('clips long previews without changing the selected content', () => {
    const selectedText = 'a'.repeat(90);

    expect(getSelectionPreview(selectedText)).toBe(`${'a'.repeat(80)}...`);
  });

  it('keeps toolbar position inside viewport margins', () => {
    const rect = DOMRect.fromRect({ height: 18, width: 30, x: -20, y: 4 });

    expect(getSelectionToolbarPosition(rect, 320)).toEqual({
      left: 12,
      top: 12,
    });
  });
});
