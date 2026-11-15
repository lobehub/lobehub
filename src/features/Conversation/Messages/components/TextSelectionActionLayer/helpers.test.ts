import { describe, expect, it } from 'vitest';

import {
  createTextSelectionContext,
  getRangeFirstLineRect,
  getSelectionPreview,
  getSelectionToolbarPosition,
  isSameTextSelectionContext,
  isTextSelectionAdded,
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

  it('reports the added state while the same text is pending in the composer', () => {
    const pending = createTextSelectionContext({
      id: 'selection-1',
      selectedText: 'selected text',
      title: 'Message selection',
    });

    // A repeated selection of the added text must surface the added state rather than
    // offering an add that is silently deduped.
    expect(isTextSelectionAdded([pending], '  selected text ')).toBe(true);
    expect(isTextSelectionAdded([pending], 'other text')).toBe(false);
    // Removing the chip (or sending the message) clears it.
    expect(isTextSelectionAdded([], 'selected text')).toBe(false);
    // A file or page reference with the same content is a different context.
    expect(isTextSelectionAdded([{ ...pending, filePath: 'src/a.ts' }], 'selected text')).toBe(
      false,
    );
  });

  it('clips long previews without changing the selected content', () => {
    const selectedText = 'a'.repeat(90);

    expect(getSelectionPreview(selectedText)).toBe(`${'a'.repeat(80)}...`);
  });

  it('anchors the toolbar above the first selected line', () => {
    const rect = DOMRect.fromRect({ height: 18, width: 100, x: 200, y: 300 });

    expect(
      getSelectionToolbarPosition(rect, {
        selectionBottom: 360,
        viewportHeight: 800,
        viewportWidth: 1280,
      }),
    ).toEqual({
      left: 250,
      placement: 'top',
      top: 288,
    });
  });

  it('keeps the toolbar inside horizontal viewport margins', () => {
    const rect = DOMRect.fromRect({ height: 18, width: 30, x: -20, y: 300 });

    expect(
      getSelectionToolbarPosition(rect, {
        selectionBottom: 318,
        viewportHeight: 800,
        viewportWidth: 320,
      }).left,
    ).toBe(12);
  });

  it('flips below the whole selection when there is no room above', () => {
    // A selection near the viewport top used to clamp to top=12 while the toolbar is
    // translated -100%, which pushed it entirely off-screen.
    const rect = DOMRect.fromRect({ height: 18, width: 30, x: 100, y: 4 });

    expect(
      getSelectionToolbarPosition(rect, {
        selectionBottom: 70,
        viewportHeight: 800,
        viewportWidth: 320,
      }),
    ).toEqual({
      left: 115,
      placement: 'bottom',
      top: 82,
    });
  });

  it('keeps a flipped toolbar on screen when the selection overflows the viewport', () => {
    // First line scrolled above the viewport and the selection ends below it.
    const rect = DOMRect.fromRect({ height: 18, width: 30, x: 100, y: -200 });

    expect(
      getSelectionToolbarPosition(rect, {
        selectionBottom: 1200,
        viewportHeight: 800,
        viewportWidth: 320,
      }),
    ).toEqual({
      left: 115,
      placement: 'bottom',
      top: 752,
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
