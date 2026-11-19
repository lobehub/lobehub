import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getFirstLineRect,
  getRangeFirstLineRect,
  getRangeTextRects,
  getSelectionToolbarPosition,
} from './selectionToolbar';

describe('selection toolbar helpers', () => {
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

describe('getRangeTextRects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('anchors a cross-page selection on its text, not on overlay layers inside the range', () => {
    document.body.innerHTML = `
      <div class="page" data-page-number="2">
        <div class="textLayer"><span id="start">crossing sentence starts</span></div>
        <div class="annotationLayer"></div>
      </div>
      <div class="page" data-page-number="3">
        <div class="textLayer"><span id="end">and ends here</span></div>
      </div>`;
    const startText = document.querySelector('#start')!.firstChild as Text;
    const endText = document.querySelector('#end')!.firstChild as Text;

    const startRect = DOMRect.fromRect({ height: 16, width: 120, x: 40, y: 760 });
    const endRect = DOMRect.fromRect({ height: 16, width: 60, x: 40, y: 840 });
    // The page-2 annotation layer covers the whole page and lies wholly
    // inside the range, so the browser reports its box from the page top.
    const overlayRect = DOMRect.fromRect({ height: 800, width: 600, x: 0, y: 0 });
    const textRects = new Map<Node, DOMRect>([
      [startText, startRect],
      [endText, endRect],
    ]);
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const rects =
        this.startContainer === this.endContainer
          ? // Whitespace between the layers lays out to no box.
            [textRects.get(this.startContainer)].filter(Boolean)
          : [startRect, overlayRect, endRect];
      return rects as unknown as DOMRectList;
    });

    const range = document.createRange();
    range.setStart(startText, 9);
    range.setEnd(endText, 3);

    expect(getRangeFirstLineRect(range)?.top).toBe(0);
    expect(getRangeTextRects(range)).toEqual([startRect, endRect]);
    expect(getFirstLineRect(getRangeTextRects(range))).toEqual(startRect);
  });
});
