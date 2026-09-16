import { describe, expect, it } from 'vitest';

import { lineAt } from './BlockCommentMarker';

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
