/**
 * Input handling shared by both `lobe-browser` devices: the desktop app's panel
 * (Electron `sendInputEvent`) and the headless `agent-browser` under
 * `lh connect`. Each speaks its own key dialect and silently drops a name it
 * does not know, so the model's key is validated and normalized here once and
 * an unknown key fails the call instead of reporting a press that never landed.
 */

export type BrowserKeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface BrowserKeyCombo {
  /** Normalized `Modifier+…+Key`, the form `agent-browser press` takes. */
  combo: string;
  /** A named key (`ArrowDown`, `Space`, `F5`) or a single character. */
  key: string;
  modifiers: BrowserKeyModifier[];
}

/** Text-editing shortcut the browser leaves to the native menu on macOS. */
export type BrowserEditCommand = 'copy' | 'cut' | 'paste' | 'redo' | 'selectAll' | 'undo';

const MODIFIER_ORDER: BrowserKeyModifier[] = ['Control', 'Alt', 'Shift', 'Meta'];

const MODIFIER_ALIASES: Record<string, BrowserKeyModifier | 'ControlOrMeta'> = {
  alt: 'Alt',
  cmd: 'Meta',
  cmdorctrl: 'ControlOrMeta',
  command: 'Meta',
  commandorcontrol: 'ControlOrMeta',
  control: 'Control',
  controlormeta: 'ControlOrMeta',
  ctrl: 'Control',
  meta: 'Meta',
  opt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

/** Lower-cased alias → the `KeyboardEvent.key`-style name both devices accept. */
const NAMED_KEYS: Record<string, string> = {
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  down: 'ArrowDown',
  end: 'End',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  home: 'Home',
  insert: 'Insert',
  left: 'ArrowLeft',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  return: 'Enter',
  right: 'ArrowRight',
  space: 'Space',
  tab: 'Tab',
  up: 'ArrowUp',
};

for (let n = 1; n <= 12; n += 1) NAMED_KEYS[`f${n}`] = `F${n}`;

const SUPPORTED_KEYS_HINT =
  'Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1–F12, or a single character, optionally with Control/Alt/Shift/Meta, e.g. "Control+a" or "Shift+Tab"';

const normalizeKey = (raw: string): string | undefined => {
  if (raw === ' ') return 'Space';
  // One character (by code point, so an emoji or CJK character counts as one).
  if ([...raw].length === 1) return raw;
  return NAMED_KEYS[raw.toLowerCase()];
};

/**
 * Parses a key or `+`-joined combination such as `Enter`, `Control+a`,
 * `Shift+Tab`, `Meta+Shift+z` or `Control++`. `ControlOrMeta` (also
 * `CmdOrCtrl`) becomes Meta on macOS and Control elsewhere, so a model that
 * does not know the device's OS can still ask for "select all".
 *
 * @throws when the key is empty, unknown, or combines two non-modifier keys
 */
export const parseBrowserKey = (
  input: unknown,
  platform: string = process.platform,
): BrowserKeyCombo => {
  if (typeof input !== 'string' || !input) throw new Error('key is required');

  // A trailing `+` is the plus key itself: `+`, `Control++`.
  let parts = input.split('+');
  if (input === '+' || input.endsWith('++')) parts = [...parts.slice(0, -2), '+'];
  const modifiers = new Set<BrowserKeyModifier>();
  let key: string | undefined;

  for (const [index, part] of parts.entries()) {
    const isLast = index === parts.length - 1;
    const token = isLast ? part : part.trim();
    const modifier = isLast ? undefined : MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier) {
      modifiers.add(
        modifier === 'ControlOrMeta' ? (platform === 'darwin' ? 'Meta' : 'Control') : modifier,
      );
      continue;
    }
    if (!isLast) {
      throw new Error(`Unknown modifier "${token}" in key "${input}". Use ${SUPPORTED_KEYS_HINT}.`);
    }
    key = normalizeKey(token === ' ' ? token : token.trim());
    if (!key) throw new Error(`Unsupported key "${input}". Use ${SUPPORTED_KEYS_HINT}.`);
  }

  if (!key) throw new Error(`Key "${input}" has no key to press. Use ${SUPPORTED_KEYS_HINT}.`);

  // agent-browser types the key as given, so `Shift+h` would still type "h".
  if (modifiers.has('Shift') && [...key].length === 1) key = key.toUpperCase();

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return { combo: [...ordered, key].join('+'), key, modifiers: ordered };
};

const MAC_EDIT_COMMANDS: Record<string, BrowserEditCommand> = {
  a: 'selectAll',
  c: 'copy',
  v: 'paste',
  x: 'cut',
  z: 'undo',
};

/**
 * The editing command a combo stands for on macOS (Meta+A → selectAll,
 * Meta+Shift+Z → redo, …). Chromium on macOS runs these through the app menu,
 * not the page, so a synthesized key event alone selects or pastes nothing;
 * the caller has to issue the command itself. Undefined off macOS, where the
 * page handles Control+A and friends from the key event.
 */
export const browserEditCommandOf = (
  { key, modifiers }: BrowserKeyCombo,
  platform: string = process.platform,
): BrowserEditCommand | undefined => {
  if (platform !== 'darwin' || !modifiers.includes('Meta')) return undefined;
  if (modifiers.includes('Control') || modifiers.includes('Alt')) return undefined;
  const command = MAC_EDIT_COMMANDS[key.toLowerCase()];
  if (!command) return undefined;
  if (modifiers.includes('Shift')) return command === 'undo' ? 'redo' : undefined;
  return command;
};

/** Default viewport of the headless browser, and the one `setViewport` without a size restores. */
export const DEFAULT_BROWSER_VIEWPORT = { height: 720, width: 1280 } as const;

const VIEWPORT_LIMITS = { height: [240, 2160], width: [320, 3840] } as const;

/**
 * Validates `setViewport` args: both sizes for a fixed viewport, neither to go
 * back to the device's default (`undefined`).
 *
 * @throws when only one size is given or a size is not a whole number in range
 */
export const parseBrowserViewport = (args: {
  height?: unknown;
  width?: unknown;
}): { height: number; width: number } | undefined => {
  const { height, width } = args;
  if (width === undefined && height === undefined) return undefined;
  const size = { height, width };
  for (const name of ['width', 'height'] as const) {
    const value = size[name];
    const [min, max] = VIEWPORT_LIMITS[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(
        `${name} must be a whole number of CSS pixels between ${min} and ${max}; omit both width and height to reset the viewport`,
      );
    }
  }
  return size as { height: number; width: number };
};
