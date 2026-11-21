import type { DiffAction, IEditor } from '@lobehub/editor';
import { LITEXML_DIFFNODE_ALL_COMMAND } from '@lobehub/editor';
import { $setSelection } from 'lexical';

export const resolveAllDiffs = (editor: IEditor, action: DiffAction) => {
  const lexicalEditor = editor.getLexicalEditor();
  if (!lexicalEditor) return;

  // Resolving a top-level diff selects the end of its parent, the root, which scrolls
  // the page to the bottom. The command queues its update as a nested one, so the
  // selection reset is queued too: both land in this commit, the reset last.
  lexicalEditor.update(() => {
    lexicalEditor.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, { action });
    lexicalEditor.update(() => $setSelection(null));
  });
};
