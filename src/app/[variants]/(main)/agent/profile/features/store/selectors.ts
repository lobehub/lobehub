import type {Store} from './action';

export const selectors = {
  editor: (s: Store) => s.editor,
  editorState: (s: Store) => s.editorState,
};
