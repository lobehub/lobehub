import { describe, expect, it } from 'vitest';

import { resolveTerminalKeyAction } from './keybindings';

const key = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, type: 'keydown', ...init }) as KeyboardEvent;

describe('resolveTerminalKeyAction — Ghostty ⌘ defaults', () => {
  it('sends Ctrl-A for ⌘← so readline jumps to the line start', () => {
    expect(resolveTerminalKeyAction(key({ key: 'ArrowLeft', metaKey: true }))).toEqual({
      bytes: '\u0001',
      type: 'send',
    });
  });

  it('sends Ctrl-E for ⌘→', () => {
    expect(resolveTerminalKeyAction(key({ key: 'ArrowRight', metaKey: true }))).toEqual({
      bytes: '\u0005',
      type: 'send',
    });
  });

  it('sends Ctrl-U for ⌘⌫', () => {
    expect(resolveTerminalKeyAction(key({ key: 'Backspace', metaKey: true }))).toEqual({
      bytes: '\u0015',
      type: 'send',
    });
  });

  it('scrolls the viewport for ⌘Home / ⌘End / ⌘PageUp / ⌘PageDown', () => {
    expect(resolveTerminalKeyAction(key({ key: 'Home', metaKey: true }))?.type).toBe('scrollToTop');
    expect(resolveTerminalKeyAction(key({ key: 'End', metaKey: true }))?.type).toBe(
      'scrollToBottom',
    );
    expect(resolveTerminalKeyAction(key({ key: 'PageUp', metaKey: true }))).toEqual({
      pages: -1,
      type: 'scrollPages',
    });
    expect(resolveTerminalKeyAction(key({ key: 'PageDown', metaKey: true }))).toEqual({
      pages: 1,
      type: 'scrollPages',
    });
  });

  it('moves between split panes for ⌘⌥← / ⌘⌥→', () => {
    expect(
      resolveTerminalKeyAction(key({ altKey: true, key: 'ArrowLeft', metaKey: true })),
    ).toEqual({ direction: -1, type: 'focusSiblingPane' });
    expect(
      resolveTerminalKeyAction(key({ altKey: true, key: 'ArrowRight', metaKey: true })),
    ).toEqual({ direction: 1, type: 'focusSiblingPane' });
  });
});

describe('resolveTerminalKeyAction — keys that must reach xterm untouched', () => {
  it('ignores plain arrows, which xterm encodes as CSI sequences itself', () => {
    expect(resolveTerminalKeyAction(key({ key: 'ArrowLeft' }))).toBeUndefined();
  });

  it('ignores ⌥← / ⌥→ — xterm already rewrites those to ESC b / ESC f on macOS', () => {
    expect(resolveTerminalKeyAction(key({ altKey: true, key: 'ArrowLeft' }))).toBeUndefined();
    expect(resolveTerminalKeyAction(key({ altKey: true, key: 'ArrowRight' }))).toBeUndefined();
  });

  it('ignores ⌘↑ / ⌘↓ — jump_to_prompt needs shell integration we do not emit', () => {
    expect(resolveTerminalKeyAction(key({ key: 'ArrowUp', metaKey: true }))).toBeUndefined();
    expect(resolveTerminalKeyAction(key({ key: 'ArrowDown', metaKey: true }))).toBeUndefined();
  });

  it('ignores ⌘⇧← and ⌘⌃← so app-level and split-resize combos stay free', () => {
    expect(
      resolveTerminalKeyAction(key({ key: 'ArrowLeft', metaKey: true, shiftKey: true })),
    ).toBeUndefined();
    expect(
      resolveTerminalKeyAction(key({ ctrlKey: true, key: 'ArrowLeft', metaKey: true })),
    ).toBeUndefined();
  });

  it('ignores keyup, so a binding fires once rather than twice', () => {
    expect(
      resolveTerminalKeyAction(key({ key: 'ArrowLeft', metaKey: true, type: 'keyup' })),
    ).toBeUndefined();
  });
});
