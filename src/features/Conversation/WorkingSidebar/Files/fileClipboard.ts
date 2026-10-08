import { create } from 'zustand';

export interface FileClipboardItem {
  isDirectory: boolean;
  name: string;
  path: string;
}

export interface FileClipboard {
  items: FileClipboardItem[];
  mode: 'copy' | 'cut';
  /** Device + project root the items were taken from; paste only works in the same scope. */
  scopeKey: string;
}

interface FileClipboardStore {
  clear: () => void;
  clipboard?: FileClipboard;
  set: (clipboard: FileClipboard) => void;
}

export const getFileClipboardScopeKey = (deviceId: string | undefined, root: string) =>
  `${deviceId ?? 'local'}\0${root}`;

/**
 * In-app clipboard for the Files tree's copy / cut / paste. Kept outside the
 * panel so it survives switching sidebar tabs, and scoped per device + project
 * so a path is never pasted onto a different machine.
 */
export const useFileClipboardStore = create<FileClipboardStore>()((set) => ({
  clear: () => set({ clipboard: undefined }),
  clipboard: undefined,
  set: (clipboard) => set({ clipboard }),
}));
