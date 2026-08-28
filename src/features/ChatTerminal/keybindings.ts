export type TerminalKeyAction =
  | { bytes: string; type: 'send' }
  | { direction: -1 | 1; type: 'focusSiblingPane' }
  | { pages: number; type: 'scrollPages' }
  | { type: 'scrollToBottom' }
  | { type: 'scrollToTop' };

/**
 * Ghostty's default ⌘ bindings, which xterm.js leaves unhandled on purpose:
 * its arrow-key cases bail on `metaKey` so embedders can claim ⌘ themselves.
 * Source of truth is `ghostty +list-keybinds --default` (checked on 1.3.1).
 *
 * ⌥←/⌥→ are absent here because xterm.js already rewrites them to ESC b / ESC f
 * on macOS, which is exactly what Ghostty binds them to.
 *
 * Left unimplemented on purpose — don't "restore" these without the machinery:
 * - ⌘↑/⌘↓ (jump_to_prompt) needs OSC 133 shell integration we don't emit
 * - ⇧+arrows (adjust_selection) has no keyboard-selection API in xterm.js
 * - ⌘⌃+arrows (resize_split) has no meaning for our relative flex widths
 */
// readline control codes, named for what the shell does with them
const BEGINNING_OF_LINE = '\u0001';
const END_OF_LINE = '\u0005';
const KILL_TO_LINE_START = '\u0015';

export const resolveTerminalKeyAction = (event: KeyboardEvent): TerminalKeyAction | undefined => {
  if (event.type !== 'keydown' || !event.metaKey || event.ctrlKey || event.shiftKey) return;

  if (event.altKey) {
    if (event.key === 'ArrowLeft') return { direction: -1, type: 'focusSiblingPane' };
    if (event.key === 'ArrowRight') return { direction: 1, type: 'focusSiblingPane' };
    return;
  }

  switch (event.key) {
    case 'ArrowLeft': {
      return { bytes: BEGINNING_OF_LINE, type: 'send' };
    }
    case 'ArrowRight': {
      return { bytes: END_OF_LINE, type: 'send' };
    }
    case 'Backspace': {
      return { bytes: KILL_TO_LINE_START, type: 'send' };
    }
    case 'End': {
      return { type: 'scrollToBottom' };
    }
    case 'Home': {
      return { type: 'scrollToTop' };
    }
    case 'PageDown': {
      return { pages: 1, type: 'scrollPages' };
    }
    case 'PageUp': {
      return { pages: -1, type: 'scrollPages' };
    }
    default: {
      return;
    }
  }
};
