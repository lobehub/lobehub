export type FileTreeShortcut = 'copy' | 'cut' | 'delete' | 'open' | 'paste';

interface ShortcutKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Maps a key press on a focused Files tree row to an operation. F2 (rename)
 * and Escape are handled by the tree itself.
 * - Enter opens, like a click (not rename: that is F2 here).
 * - Delete, or ⌘⌫ on macOS, moves to the trash (after a confirmation).
 * - ⌘C / ⌘X / ⌘V (Ctrl elsewhere) copy, cut and paste entries.
 */
export const resolveFileTreeShortcut = (
  event: ShortcutKeyEvent,
  isMac: boolean,
): FileTreeShortcut | null => {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const otherMod = isMac ? event.ctrlKey : event.metaKey;
  if (event.altKey || otherMod) return null;

  if (!mod && !event.shiftKey) {
    if (event.key === 'Enter') return 'open';
    if (event.key === 'Delete') return 'delete';
    return null;
  }
  if (!mod || event.shiftKey) return null;

  if (isMac && event.key === 'Backspace') return 'delete';
  switch (event.key.toLowerCase()) {
    case 'c': {
      return 'copy';
    }
    case 'x': {
      return 'cut';
    }
    case 'v': {
      return 'paste';
    }
    default: {
      return null;
    }
  }
};
