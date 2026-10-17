import { describe, expect, it, vi } from 'vitest';

import {
  captureEditingTarget,
  isEditingMenuRole,
  restoreEditingTarget,
  runWhenMenuFocusSettles,
} from './editingFocus';

describe('isEditingMenuRole', () => {
  it('matches page editing roles only', () => {
    expect(isEditingMenuRole('paste')).toBe(true);
    expect(isEditingMenuRole('selectAll')).toBe(true);
    expect(isEditingMenuRole('quit')).toBe(false);
    expect(isEditingMenuRole(undefined)).toBe(false);
  });
});

describe('captureEditingTarget', () => {
  it('keeps an input selection and ignores non-editable focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.value = 'hello';
    input.setSelectionRange(1, 4);

    const target = captureEditingTarget(input);

    expect(target).toMatchObject({ element: input, selectionEnd: 4, selectionStart: 1 });
    expect(captureEditingTarget(document.body)).toBeNull();

    input.blur();
    expect(restoreEditingTarget(target)).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);

    input.remove();
    expect(restoreEditingTarget(target)).toBe(false);
  });

  it('restores a contenteditable range', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'hello';
    document.body.append(editor);
    editor.focus();

    const text = editor.firstChild;
    if (!text) throw new Error('expected text');
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const target = captureEditingTarget(editor);
    editor.blur();
    selection?.removeAllRanges();

    expect(restoreEditingTarget(target)).toBe(true);
    expect(selection?.toString()).toBe('ell');

    editor.remove();
  });
});

describe('runWhenMenuFocusSettles', () => {
  it('runs the action on the second frame, after menu focus restoration', () => {
    const frames: Array<() => void> = [];
    const action = vi.fn();

    runWhenMenuFocusSettles(action, (frame) => {
      frames.push(frame);
    });

    expect(action).not.toHaveBeenCalled();
    frames[0]?.();
    expect(action).not.toHaveBeenCalled();
    frames[1]?.();
    expect(action).toHaveBeenCalledOnce();
  });
});
