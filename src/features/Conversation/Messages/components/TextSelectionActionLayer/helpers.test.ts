import { describe, expect, it } from 'vitest';

import {
  createTextSelectionContext,
  getRangeFirstLineRect,
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

  it('uses the first visual line of a multi-line selection for toolbar anchoring', () => {
    const firstLineStart = DOMRect.fromRect({ height: 18, width: 40, x: 120, y: 20 });
    const secondLine = DOMRect.fromRect({ height: 18, width: 280, x: 40, y: 44 });
    const firstLineEnd = DOMRect.fromRect({ height: 17, width: 60, x: 170, y: 21 });
    const range = {
      getBoundingClientRect: () => secondLine,
      getClientRects: () => [firstLineStart, secondLine, firstLineEnd],
    } as unknown as Range;

    expect(getRangeFirstLineRect(range)).toEqual(
      DOMRect.fromRect({ height: 18, width: 110, x: 120, y: 20 }),
    );
  });
});
