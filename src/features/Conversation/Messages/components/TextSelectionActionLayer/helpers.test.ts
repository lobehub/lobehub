import { describe, expect, it } from 'vitest';

import { getRangeFirstLineRect, getSelectionToolbarPosition } from './helpers';

describe('TextSelectionActionLayer helpers', () => {
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
