import type { IEditor } from '@lobehub/editor';
import { $createParagraphNode, $getRoot, $isParagraphNode, type LexicalEditor } from 'lexical';

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const selectEditorStartLineOnLexical = (lexicalEditor: LexicalEditor): void => {
  lexicalEditor.update(() => {
    const root = $getRoot();
    const first = root.getFirstChild();

    // An empty first line is already the line the caller wants; adding another
    // would stack a blank line on every call.
    if ($isParagraphNode(first) && first.getChildrenSize() === 0) {
      first.selectStart();
      return;
    }

    const paragraph = $createParagraphNode();
    if (first) first.insertBefore(paragraph);
    else root.append(paragraph);
    paragraph.selectStart();
  });
};

/**
 * Move the caret to an empty first line of the document, opening one above the
 * existing content when the document does not start with it.
 *
 * This is what Enter in a title field hands over to the body: the title and
 * the body read as one document, so Enter at the title continues on a fresh
 * line instead of landing inside whatever the body already starts with (an
 * image, a pasted block, …).
 */
export const focusEditorStartLine = (editor: IEditor | undefined): void => {
  const lexicalEditor = editor?.getLexicalEditor?.();
  if (!editor || !lexicalEditor) return;

  selectEditorStartLineOnLexical(lexicalEditor);
  editor.focus();
};
