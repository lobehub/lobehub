import { type Store } from './action';

export const selectors = {
  chatPanelExpanded: (s: Store) => s.chatPanelExpanded,
  editor: (s: Store) => s.editor,
  editorState: (s: Store) => s.editorState,
};
