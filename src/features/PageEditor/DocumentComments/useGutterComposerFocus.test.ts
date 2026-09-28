import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGutterComposerFocus } from './useGutterComposerFocus';

/** A caret inside the box, the way a browser places one when a contenteditable takes focus. */
const placeCaret = (input: HTMLElement) => {
  const range = document.createRange();
  range.setStart(input, 0);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const mount = () => {
  const root = document.createElement('div');
  const input = document.createElement('div');
  input.setAttribute('contenteditable', 'true');
  input.tabIndex = 0;
  root.append(input);
  document.body.append(root);
  const nativeFocus = HTMLElement.prototype.focus;
  const focus = vi.spyOn(input, 'focus').mockImplementation(function (this: HTMLElement) {
    nativeFocus.call(this);
    placeCaret(input);
  });
  return { focus, input, root };
};

const caretIn = (root: HTMLElement) =>
  root.contains(document.activeElement) &&
  root.contains(document.getSelection()?.anchorNode ?? null);

describe('useGutterComposerFocus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('does not try to focus a card that is not positioned yet', () => {
    const { focus, root } = mount();
    const editorFocus = vi.fn();

    renderHook(() =>
      useGutterComposerFocus({
        editorRef: { current: { focus: editorFocus } },
        pick: 1,
        ready: false,
        rootRef: { current: root },
      }),
    );
    vi.advanceTimersByTime(2000);

    expect(focus).not.toHaveBeenCalled();
    expect(editorFocus).not.toHaveBeenCalled();
  });

  it('focuses once the card is positioned, however late that is', () => {
    const { focus, root } = mount();
    const editorFocus = vi.fn();

    const { rerender } = renderHook(
      ({ ready }) =>
        useGutterComposerFocus({
          editorRef: { current: { focus: editorFocus } },
          pick: 1,
          ready,
          rootRef: { current: root },
        }),
      { initialProps: { ready: false } },
    );
    vi.advanceTimersByTime(5000);
    rerender({ ready: true });
    vi.advanceTimersByTime(0);

    expect(focus).toHaveBeenCalled();
    expect(editorFocus).toHaveBeenCalled();
    expect(caretIn(root)).toBe(true);
  });

  it('retries until the focus sticks', () => {
    const { focus, input, root } = mount();
    // Something else keeps taking the focus back for a while.
    const stealer = document.createElement('button');
    document.body.append(stealer);
    let steals = 3;
    focus.mockImplementation(() => {
      if (steals-- > 0) {
        stealer.focus();
      } else {
        HTMLElement.prototype.focus.call(input);
        placeCaret(input);
      }
    });

    renderHook(() =>
      useGutterComposerFocus({
        editorRef: { current: null },
        pick: 1,
        ready: true,
        rootRef: { current: root },
      }),
    );
    vi.advanceTimersByTime(500);

    expect(focus).toHaveBeenCalledTimes(4);
    expect(caretIn(root)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(focus).toHaveBeenCalledTimes(4);
  });

  it('rebuilds the caret when the box is focused but holds no selection', () => {
    const { focus, input, root } = mount();
    // The box already has DOM focus (its editor auto-focused on mount), but
    // the body's blur wiped every DOM range, so there is no caret to type at.
    HTMLElement.prototype.focus.call(input);
    document.getSelection()?.removeAllRanges();
    expect(document.activeElement).toBe(input);
    const editorFocus = vi.fn(() => placeCaret(input));

    renderHook(() =>
      useGutterComposerFocus({
        editorRef: { current: { focus: editorFocus } },
        pick: 1,
        ready: true,
        rootRef: { current: root },
      }),
    );
    vi.advanceTimersByTime(0);

    expect(editorFocus).toHaveBeenCalledTimes(1);
    expect(caretIn(root)).toBe(true);
    // The DOM focus is left alone: re-focusing an active box is a no-op at
    // best and a scroll jump at worst.
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(editorFocus).toHaveBeenCalledTimes(1);
  });

  it('brings the caret back for a repeated pick of the same run', () => {
    const { focus, input, root } = mount();

    const { rerender } = renderHook(
      ({ pick }) =>
        useGutterComposerFocus({
          editorRef: { current: null },
          pick,
          ready: true,
          rootRef: { current: root },
        }),
      { initialProps: { pick: 1 } },
    );
    vi.advanceTimersByTime(0);
    expect(focus).toHaveBeenCalledTimes(1);

    input.blur();
    document.getSelection()?.removeAllRanges();
    rerender({ pick: 2 });
    vi.advanceTimersByTime(0);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(caretIn(root)).toBe(true);
  });
});
