import { type Store } from './action';

export const selectors = {
  currentDocId: (s: Store) => s.currentDocId,
  currentTitle: (s: Store) => s.currentTitle,
  editor: (s: Store) => s.editor,
  saveStatus: (s: Store) => s.saveStatus,
  wordCount: (s: Store) => s.wordCount,
};
