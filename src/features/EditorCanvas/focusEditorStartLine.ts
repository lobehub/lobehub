import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  type LexicalEditor,
} from 'lexical';

const $selectStartLine = (text: string) => {
  const root = $getRoot();
  const first = root.getFirstChild();

  // An empty first line is already the line the caller wants; adding another
  // would stack a blank line on every call. Text carried over from the title
  // always gets a line of its own, though, so it is never glued onto whatever
  // the body starts with.
  if (!text && $isParagraphNode(first) && first.getChildrenSize() === 0) {
    first.selectStart();
    return;
  }

  const paragraph = $createParagraphNode();
  if (text) paragraph.append($createTextNode(text));
  if (first) first.insertBefore(paragraph);
  else root.append(paragraph);
  paragraph.selectStart();
};

/**
 * The editor's Lexical instance, when it can take the caret and text right now:
 * mounted in the page and editable. While the body is still loading (or after
 * a document switch, before the next body mounts) the kernel may hold no
 * Lexical editor, or a detached one whose content is about to be replaced —
 * anything written there would be lost.
 */
export const getWritableLexicalEditor = (editor: IEditor | undefined) => {
  const lexicalEditor = editor?.getLexicalEditor?.();
  if (!lexicalEditor?.getRootElement() || !lexicalEditor.isEditable()) return null;
  return lexicalEditor;
};

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const selectEditorStartLineOnLexical = (lexicalEditor: LexicalEditor, text = ''): void => {
  lexicalEditor.update(() => $selectStartLine(text));
};

/**
 * Move the caret to an empty first line of the document, opening one above the
 * existing content when the document does not start with it.
 *
 * This is what Enter in a title field hands over to the body: the title and
 * the body read as one document, so Enter at the title continues on a fresh
 * line instead of landing inside whatever the body already starts with (an
 * image, a pasted block, …).
 *
 * `text` is the part of the title after the caret that Enter splits off: it
 * becomes the body's new first line, with the caret at its start.
 */
export const focusEditorStartLine = (editor: IEditor | undefined, text?: string): void => {
  const lexicalEditor = getWritableLexicalEditor(editor);
  if (!editor || !lexicalEditor) return;

  selectEditorStartLineOnLexical(lexicalEditor, text);
  editor.focus();
};

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const selectEditorFirstLineOnLexical = (lexicalEditor: LexicalEditor): void => {
  lexicalEditor.update(() => {
    const first = $getRoot().getFirstChild();
    // A text block (paragraph, heading, list, quote, table…) takes the caret at
    // its start; a block image or divider has no line to stand on, so open one.
    if ($isElementNode(first) && !first.isInline()) {
      first.selectStart();
      return;
    }
    $selectStartLine('');
  });
};

/**
 * Move the caret to the start of the body's first line, opening a line only
 * when the body has none to stand on — ArrowDown out of the title.
 */
export const focusEditorFirstLine = (editor: IEditor | undefined): void => {
  const lexicalEditor = getWritableLexicalEditor(editor);
  if (!editor || !lexicalEditor) return;

  selectEditorFirstLineOnLexical(lexicalEditor);
  editor.focus();
};
