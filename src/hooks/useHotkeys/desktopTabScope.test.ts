import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRegisterDesktopTabHotkeys } from './desktopTabScope';

const state = vi.hoisted(() => ({
  activeTabId: 'second',
  switchTab: vi.fn(),
  tabs: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: { getState: () => state },
}));

const press = (
  key: string,
  code: string,
  modifiers: KeyboardEventInit = {},
  target: EventTarget = document,
) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, ...modifiers }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, ...modifiers }));
  });
};

describe('desktop tab shortcuts', () => {
  beforeEach(() => {
    state.activeTabId = 'second';
    state.tabs = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
    state.switchTab.mockReset();
    state.switchTab.mockImplementation((id: string) => {
      state.activeTabId = id;
    });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it('selects tabs by physical number key on non-US keyboard layouts', () => {
    renderHook(useRegisterDesktopTabHotkeys);

    press('&', 'Digit1', { ctrlKey: true });
    expect(state.switchTab).toHaveBeenLastCalledWith('first');

    press('3', 'Digit3', { ctrlKey: true });
    expect(state.switchTab).toHaveBeenLastCalledWith('third');
  });

  it('cycles in both directions and wraps at either end', () => {
    renderHook(useRegisterDesktopTabHotkeys);

    state.activeTabId = 'third';
    press('Tab', 'Tab', { ctrlKey: true });
    expect(state.switchTab).toHaveBeenLastCalledWith('first');

    state.activeTabId = 'first';
    press('Tab', 'Tab', { ctrlKey: true, shiftKey: true });
    expect(state.switchTab).toHaveBeenLastCalledWith('third');
  });

  it('works while the chat editor is focused', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    // jsdom does not implement this browser property.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    document.body.append(editor);
    editor.focus();
    renderHook(useRegisterDesktopTabHotkeys);

    press('1', 'Digit1', { ctrlKey: true }, editor);
    expect(state.switchTab).toHaveBeenLastCalledWith('first');
    press('Tab', 'Tab', { ctrlKey: true }, editor);
    expect(state.switchTab).toHaveBeenLastCalledWith('second');
  });

  it('keeps cycling after the destination chat editor takes focus, without another click', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    document.body.append(editor);
    renderHook(useRegisterDesktopTabHotkeys);

    press('Tab', 'Tab', { ctrlKey: true });
    expect(state.activeTabId).toBe('third');
    editor.focus();

    for (const expected of ['first', 'second', 'third', 'first']) {
      press('Tab', 'Tab', { ctrlKey: true }, editor);
      expect(state.activeTabId).toBe(expected);
    }
    for (const expected of ['third', 'second', 'first', 'third']) {
      press('Tab', 'Tab', { ctrlKey: true, shiftKey: true }, editor);
      expect(state.activeTabId).toBe(expected);
    }
  });

  it('ignores missing tabs, empty lists and unrelated modifier combinations', () => {
    renderHook(useRegisterDesktopTabHotkeys);
    press('9', 'Digit9', { ctrlKey: true });
    press('1', 'Digit1', { altKey: true });
    press('1', 'Digit1', { altKey: true, ctrlKey: true });
    press('Tab', 'Tab', { altKey: true });
    state.tabs = [];
    press('Tab', 'Tab', { ctrlKey: true });
    press('Tab', 'Tab', { ctrlKey: true, shiftKey: true });
    expect(state.switchTab).not.toHaveBeenCalled();
  });
});
