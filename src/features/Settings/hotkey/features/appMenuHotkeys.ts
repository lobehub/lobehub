import type { AppMenuNode } from '@lobechat/electron-client-ipc';

export interface AppMenuHotkey {
  id: string;
  /** Hotkey string understood by `@lobehub/ui` `Hotkey` / `HotkeyInput`, e.g. `alt+ctrl+a`. */
  keys: string;
  label: string;
  /** Label of the top-level menu (File, View, …) the item belongs to. */
  menu: string;
}

const ACCELERATOR_KEY_MAP: Record<string, string> = {
  '-': 'minus',
  ',': 'comma',
  '.': 'period',
  '/': 'slash',
  ';': 'semicolon',
  '=': 'equal',
  '[': 'bracketleft',
  '\\': 'backslash',
  ']': 'bracketright',
  '`': 'backquote',
  "'": 'quote',
  'cmd': 'meta',
  'cmdorctrl': 'mod',
  'command': 'meta',
  'commandorcontrol': 'mod',
  'control': 'ctrl',
  'escape': 'esc',
  'option': 'alt',
  'plus': 'equal',
  'return': 'enter',
  'super': 'meta',
};

/** Convert an Electron accelerator (`Alt+CmdOrCtrl+A`) into a lobe-ui hotkey string. */
export const acceleratorToHotkey = (accelerator: string): string =>
  accelerator
    // `CmdOrCtrl++` binds the plus key itself; keep it from vanishing in the split.
    .replace(/\+\+$/, '+plus')
    .split('+')
    .map((key) => {
      const lower = key.toLowerCase();
      return ACCELERATOR_KEY_MAP[lower] ?? lower;
    })
    .join('+');

/**
 * Flatten every app menu item that carries an accelerator, in menu order, tagged with the
 * label of the top-level menu it lives in. Items repeated across menus (e.g. Minimize / Close in
 * both File and Window) are listed once, under their first menu.
 */
export const collectAppMenuHotkeys = (nodes: AppMenuNode[]): AppMenuHotkey[] => {
  const walk = (items: AppMenuNode[], menu: string): AppMenuHotkey[] =>
    items.flatMap((node) => {
      if (node.type === 'submenu') return walk(node.children ?? [], menu);
      if (node.type === 'separator' || !node.accelerator) return [];

      return [
        { id: node.id, keys: acceleratorToHotkey(node.accelerator), label: node.label, menu },
      ];
    });

  const seen = new Set<string>();

  return nodes
    .flatMap((node) => (node.type === 'submenu' ? walk(node.children ?? [], node.label) : []))
    .filter((item) => {
      const key = `${item.label}\u0000${item.keys}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
