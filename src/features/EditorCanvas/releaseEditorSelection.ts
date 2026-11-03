import type { IEditor } from '@lobehub/editor';
import { $setSelection, type LexicalEditor, SKIP_DOM_SELECTION_TAG } from 'lexical';

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const releaseEditorSelectionOnLexical = (lexicalEditor: LexicalEditor): void => {
  // The tag keeps this update from touching the DOM selection, which already
  // belongs to the field the user moved to.
  lexicalEditor.update(() => $setSelection(null), { tag: SKIP_DOM_SELECTION_TAG });
};

/**
 * Drop the editor's own selection when focus moves to a field outside it.
 *
 * Lexical keeps its last caret after a blur and restores it into the DOM on the
 * next update that changes content. An async update such as an image upload
 * finishing would then pull focus back into the editor while the user is typing
 * elsewhere. With no selection there is nothing to restore; clicking back into
 * the editor creates a new one.
 */
export const releaseEditorSelection = (editor: IEditor | undefined): void => {
  const lexicalEditor = editor?.getLexicalEditor?.();
  if (!lexicalEditor) return;

  releaseEditorSelectionOnLexical(lexicalEditor);
};
