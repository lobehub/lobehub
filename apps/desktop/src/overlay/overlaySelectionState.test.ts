import { describe, expect, it } from 'vitest';

import {
  resolveCommittedSelectionRect,
  resolveEscapeAction,
  shouldHideChatPanel,
} from './overlaySelectionState';

describe('overlaySelectionState', () => {
  it('backs out of an empty capture pass to the composer on Esc', () => {
    expect(resolveEscapeAction({ mode: 'capture', selectionCount: 0 })).toBe('exitCapture');
  });

  it('closes the overlay on Esc from the composer or once screenshots exist', () => {
    expect(resolveEscapeAction({ mode: 'compose', selectionCount: 0 })).toBe('close');
    expect(resolveEscapeAction({ mode: 'capture', selectionCount: 2 })).toBe('close');
  });

  it('keeps the pending selection rect visible until the committed selection arrives', () => {
    expect(
      resolveCommittedSelectionRect({
        pendingSelectionRect: { height: 180, width: 220, x: 96, y: 120 },
        selection: null,
      }),
    ).toEqual({
      height: 180,
      width: 220,
      x: 96,
      y: 120,
    });
  });

  it('hides the chat panel while the user is selecting or previewing a selection', () => {
    expect(
      shouldHideChatPanel({
        isPreviewingSelection: false,
        isSelecting: true,
      }),
    ).toBe(true);

    expect(
      shouldHideChatPanel({
        isPreviewingSelection: true,
        isSelecting: false,
      }),
    ).toBe(true);

    expect(
      shouldHideChatPanel({
        isPreviewingSelection: false,
        isSelecting: false,
      }),
    ).toBe(false);
  });
});
