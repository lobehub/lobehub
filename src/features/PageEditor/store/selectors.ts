import { type Store } from './action';

export const selectors = {
  documentId: (s: Store) => s.documentId,
  editor: (s: Store) => s.editor,
  emoji: (s: Store) => s.emoji,
  rightPanelMode: (s: Store) => s.rightPanelMode,
  title: (s: Store) => s.title,
};
