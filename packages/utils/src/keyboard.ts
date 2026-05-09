import { isMacOS } from './platform';

export const isCommandPressed = (event: KeyboardEvent) => {
  const isMac = isMacOS();

  if (isMac) {
    return event.metaKey; // Use metaKey (Command key) on macOS
  } else {
    return event.ctrlKey; // Use ctrlKey on Windows/Linux
  }
};

const MEDIA_KEY_PREFIXES = ['volume', 'audio', 'media', 'browser', 'launch'] as const;

/**
 * Returns true if the event's code represents a media or system key that should
 * never be treated as a user-configurable hotkey (e.g. VolumeMute, MediaPlayPause).
 */
export const isMediaKey = (event: KeyboardEvent): boolean => {
  const code = (event.code || '').toLowerCase();
  return MEDIA_KEY_PREFIXES.some((prefix) => code.startsWith(prefix));
};

// Codes for standard keys that a user may reasonably want to bind as a shortcut.
const ALLOWED_KEY_PREFIXES = [
  'key', // KeyA–KeyZ
  'digit', // Digit0–Digit9
  'numpad', // Numpad0–Numpad9, NumpadAdd, etc.
  'f', // F1–F24
  'arrow', // ArrowUp, ArrowDown, etc.
  'back', // Backquote, Backslash, Backspace
  'bracket', // BracketLeft, BracketRight
  'shift', // ShiftLeft, ShiftRight
  'alt', // AltLeft, AltRight
  'control', // ControlLeft, ControlRight
  'meta', // MetaLeft, MetaRight
  'os', // OSLeft, OSRight
  'space',
  'enter',
  'tab',
  'escape',
  'capslock',
  'comma',
  'period',
  'slash',
  'semicolon',
  'quote',
  'minus',
  'equal',
  'intl', // IntlBackslash, IntlYen, etc.
  'printscreen',
  'scrolllock',
  'pause',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'delete',
  'contextmenu',
  'numlock',
] as const;

/**
 * Returns true when the key event's `code` is a key that can reasonably be
 * bound as a user hotkey — letters, digits, punctuation, function keys, and
 * standard modifiers.  Media / browser / launch keys are explicitly excluded.
 */
export const isValidHotkeyKey = (event: KeyboardEvent): boolean => {
  const code = (event.code || '').toLowerCase();
  if (!code) return false;
  if (isMediaKey(event)) return false;
  return ALLOWED_KEY_PREFIXES.some((prefix) => code.startsWith(prefix));
};

const KNOWN_MODIFIERS = new Set([
  'ctrl',
  'control',
  'shift',
  'alt',
  'meta',
  'mod',
  'commandorcontrol',
]);

/**
 * Returns true when every token in a hotkey string (e.g. "mod+k") is a key
 * that can reasonably be bound as a shortcut.  Empty string and modifier-only
 * strings are rejected.
 */
export const isValidHotkeyString = (hotkey: string): boolean => {
  if (!hotkey?.trim()) return false;
  const tokens = hotkey
    .toLowerCase()
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const hasNonModifier = tokens.some((t) => !KNOWN_MODIFIERS.has(t));
  if (!hasNonModifier) return false;
  return tokens.every((token) => {
    if (KNOWN_MODIFIERS.has(token)) return true;
    return !MEDIA_KEY_PREFIXES.some((prefix) => token.startsWith(prefix));
  });
};
