import { describe, expect, it } from 'vitest';

import { resolveFileTreeShortcut } from './fileTreeShortcuts';

const key = (
  k: string,
  mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
) => ({
  altKey: false,
  ctrlKey: false,
  key: k,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('resolveFileTreeShortcut', () => {
  it('opens on Enter and deletes on Delete on every platform', () => {
    for (const isMac of [true, false]) {
      expect(resolveFileTreeShortcut(key('Enter'), isMac)).toBe('open');
      expect(resolveFileTreeShortcut(key('Delete'), isMac)).toBe('delete');
    }
  });

  it('deletes on ⌘⌫ on macOS only; a bare Backspace does nothing', () => {
    expect(resolveFileTreeShortcut(key('Backspace', { metaKey: true }), true)).toBe('delete');
    expect(resolveFileTreeShortcut(key('Backspace'), true)).toBeNull();
    expect(resolveFileTreeShortcut(key('Backspace', { ctrlKey: true }), false)).toBeNull();
  });

  it('maps copy / cut / paste to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(resolveFileTreeShortcut(key('c', { metaKey: true }), true)).toBe('copy');
    expect(resolveFileTreeShortcut(key('x', { metaKey: true }), true)).toBe('cut');
    expect(resolveFileTreeShortcut(key('v', { metaKey: true }), true)).toBe('paste');
    expect(resolveFileTreeShortcut(key('c', { ctrlKey: true }), false)).toBe('copy');
    expect(resolveFileTreeShortcut(key('V', { ctrlKey: true }), false)).toBe('paste');
    expect(resolveFileTreeShortcut(key('c', { ctrlKey: true }), true)).toBeNull();
    expect(resolveFileTreeShortcut(key('c', { metaKey: true }), false)).toBeNull();
  });

  it('ignores F2 (the tree renames by itself) and modified or unrelated keys', () => {
    expect(resolveFileTreeShortcut(key('F2'), true)).toBeNull();
    expect(resolveFileTreeShortcut(key('Enter', { shiftKey: true }), true)).toBeNull();
    expect(resolveFileTreeShortcut(key('c', { altKey: true, metaKey: true }), true)).toBeNull();
    expect(resolveFileTreeShortcut(key('a'), true)).toBeNull();
  });
});
