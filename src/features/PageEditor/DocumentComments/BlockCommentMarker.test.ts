import { describe, expect, it } from 'vitest';

import { inMarkerBridge, lineAt } from './BlockCommentMarker';

const rect = (partial: Partial<DOMRect>): DOMRect =>
  ({ bottom: 0, left: 0, right: 0, top: 0, ...partial }) as DOMRect;

const mount = (text: string, dir: 'ltr' | 'rtl' = 'ltr') => {
  const block = document.createElement('p');
  block.dir = dir;
  block.textContent = text;
  document.body.append(block);
  block.getBoundingClientRect = () => ({ left: 0, right: 100 }) as DOMRect;
  return block;
};

/** Simulate `caretPositionFromPoint` returning a fixed offset per x-coordinate side. */
const stubCaretPositions = (node: Node, leftOffset: number, rightOffset: number) => {
  (
    document as unknown as { caretPositionFromPoint: (x: number) => unknown }
  ).caretPositionFromPoint = (x: number) => ({
    offset: x < 50 ? leftOffset : rightOffset,
    offsetNode: node,
  });
};

describe('lineAt', () => {
  it('selects the hovered line for LTR text, where the left edge is the earlier point', () => {
    const block = mount('hello world, this is a longer paragraph');
    const text = block.firstChild!;
    stubCaretPositions(text, 6, 11);

    const range = lineAt(block, 0);

    expect(range?.collapsed).toBe(false);
    expect(range?.toString()).toBe('world');
  });

  it('orders RTL caret points by document position instead of visual left/right', () => {
    // RTL reads right to left, so the visual left edge of a line is the
    // *later* point in document order and the right edge is the earlier one —
    // the opposite of the LTR case above.
    const block = mount('مرحبا بالعالم في السطر الثاني', 'rtl');
    const text = block.firstChild!;
    stubCaretPositions(text, 12, 6);

    const range = lineAt(block, 0);

    expect(range?.collapsed).toBe(false);
    // Selects just the run between the two points, not the whole paragraph —
    // the bug this guards against falls back to selecting the entire block.
    expect(range?.toString()).toBe(block.textContent!.slice(6, 12));
    expect(range?.toString()).not.toBe(block.textContent);
  });
});

describe('inMarkerBridge', () => {
  // LTR: body on the left, marker on the right, with a gap between them.
  const bodyRect = rect({ bottom: 40, left: 0, right: 100, top: 20 });
  const markerRect = rect({ bottom: 32, left: 120, right: 140, top: 20 });

  it('treats the gap between body and marker, at the marker row, as hoverable', () => {
    // x=110 sits in the gap (past body's right edge, before the marker).
    expect(inMarkerBridge(110, 24, bodyRect, markerRect)).toBe(true);
  });

  it("treats the same gap as hoverable when the marker sits to the body's left (RTL)", () => {
    const rtlBody = rect({ bottom: 40, left: 120, right: 220, top: 20 });
    const rtlMarker = rect({ bottom: 32, left: 80, right: 100, top: 20 });

    expect(inMarkerBridge(110, 24, rtlBody, rtlMarker)).toBe(true);
  });

  it("rejects a point in the gap column but outside the marker's row", () => {
    // Same x as the hoverable case, but well below the marker's row.
    expect(inMarkerBridge(110, 200, bodyRect, markerRect)).toBe(false);
  });

  it('rejects a point entirely outside the combined body+marker span', () => {
    expect(inMarkerBridge(500, 24, bodyRect, markerRect)).toBe(false);
  });
});
