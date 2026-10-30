/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEscapeDiscardGuard } from './useEscapeDiscardGuard';

/**
 * Mirrors the modal DOM: a dialog popup holding the content, with the dialog's
 * own Escape dismissal listening on `document` like Base UI does.
 */
const setup = (hasUnsavedInput: () => boolean) => {
  const popup = document.createElement('div');
  popup.setAttribute('role', 'dialog');
  const content = document.createElement('div');
  const input = document.createElement('input');
  content.append(input);
  popup.append(content);
  // A picker opened from the modal is portalled outside the popup.
  const portalledPicker = document.createElement('input');
  document.body.append(popup, portalledPicker);

  const dismiss = vi.fn();
  const dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss();
  };
  document.addEventListener('keydown', dismissOnEscape);

  const onEscape = vi.fn();
  const hook = renderHook(() =>
    useEscapeDiscardGuard({ current: content }, { hasUnsavedInput, onEscape }),
  );

  const cleanup = () => {
    hook.unmount();
    document.removeEventListener('keydown', dismissOnEscape);
    popup.remove();
    portalledPicker.remove();
  };

  return { cleanup, dismiss, input, onEscape, popup, portalledPicker };
};

const pressEscape = (target: HTMLElement, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Escape',
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('useEscapeDiscardGuard', () => {
  it('lets Escape close an empty modal as before', () => {
    const ctx = setup(() => false);
    cleanup = ctx.cleanup;

    pressEscape(ctx.input);

    expect(ctx.dismiss).toHaveBeenCalledTimes(1);
    expect(ctx.onEscape).not.toHaveBeenCalled();
  });

  it('asks instead of closing when there is unsaved input', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;

    const event = pressEscape(ctx.input);

    expect(ctx.onEscape).toHaveBeenCalledTimes(1);
    expect(ctx.dismiss).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('also guards Escape pressed with focus on the popup itself', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;

    pressEscape(ctx.popup);

    expect(ctx.onEscape).toHaveBeenCalledTimes(1);
    expect(ctx.dismiss).not.toHaveBeenCalled();
  });

  it('reads the unsaved state at keypress time', () => {
    let dirty = false;
    const ctx = setup(() => dirty);
    cleanup = ctx.cleanup;

    dirty = true;
    pressEscape(ctx.input);

    expect(ctx.onEscape).toHaveBeenCalledTimes(1);
    expect(ctx.dismiss).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;

    pressEscape(ctx.input, { key: 'Enter' });

    expect(ctx.onEscape).not.toHaveBeenCalled();
  });

  it('leaves Escape that cancels an IME composition alone', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;

    pressEscape(ctx.input, { isComposing: true });

    expect(ctx.onEscape).not.toHaveBeenCalled();
  });

  it('leaves Escape already handled inside the modal alone', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;
    ctx.input.addEventListener('keydown', (event) => event.preventDefault());

    pressEscape(ctx.input);

    expect(ctx.onEscape).not.toHaveBeenCalled();
  });

  it('guards Escape after focus fell back to the page body', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;

    // Clicking the modal mask leaves focus on <body>, outside the popup.
    pressEscape(document.body);

    expect(ctx.onEscape).toHaveBeenCalledTimes(1);
    expect(ctx.dismiss).not.toHaveBeenCalled();
  });

  it('lets Escape on the page body close a clean modal', () => {
    const ctx = setup(() => false);
    cleanup = ctx.cleanup;

    pressEscape(document.body);

    expect(ctx.onEscape).not.toHaveBeenCalled();
    expect(ctx.dismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape on the page body to a dialog stacked above the modal', () => {
    const ctx = setup(() => true);
    const stacked = document.createElement('div');
    stacked.setAttribute('role', 'dialog');
    document.body.append(stacked);
    cleanup = () => {
      stacked.remove();
      ctx.cleanup();
    };

    pressEscape(document.body);

    expect(ctx.onEscape).not.toHaveBeenCalled();
    expect(ctx.dismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores a listbox that was already on the page below the modal', () => {
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    document.body.prepend(listbox);
    const ctx = setup(() => true);
    cleanup = () => {
      ctx.cleanup();
      listbox.remove();
    };

    pressEscape(document.body);

    expect(ctx.onEscape).toHaveBeenCalledTimes(1);
    expect(ctx.dismiss).not.toHaveBeenCalled();
  });

  it('does not intercept Escape from a picker portalled outside the popup', () => {
    const ctx = setup(() => true);
    cleanup = ctx.cleanup;

    pressEscape(ctx.portalledPicker);

    expect(ctx.onEscape).not.toHaveBeenCalled();
    expect(ctx.dismiss).toHaveBeenCalledTimes(1);
  });
});
