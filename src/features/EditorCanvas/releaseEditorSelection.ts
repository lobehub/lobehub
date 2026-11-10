import type { IEditor } from '@lobehub/editor';
import { $setSelection, type LexicalEditor } from 'lexical';

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const releaseEditorSelectionOnLexical = (lexicalEditor: LexicalEditor): void => {
  // No update tag here. This update changes no nodes, and Lexical only clears an
  // update's tags when nodes changed, so a tag such as `skip-dom-selection` would
  // stick to the next content update instead: Enter in the title would then set
  // a caret Lexical never writes to the DOM, and focus would stay in the title.
  // Untagged is safe: with no selection, Lexical only clears a DOM selection that
  // is still inside the editor, and the field the user moved to already owns it.
  lexicalEditor.update(() => $setSelection(null));
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
