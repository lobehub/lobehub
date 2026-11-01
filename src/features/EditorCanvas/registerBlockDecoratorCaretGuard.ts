import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';

/**
 * Detect a collapsed selection whose anchor sits directly on the root node.
 *
 * Lexical only produces such a point when the caret has nowhere else to go —
 * typically right before / after a block-level DecoratorNode (block image,
 * hr, …) that has no sibling paragraph. The browser then paints the native
 * caret inside the root container, which shows up as the "horizontal caret"
 * hovering over the image.
 */
const $isRootLevelCollapsedSelection = (
  selection: ReturnType<typeof $getSelection>,
): selection is RangeSelection =>
  $isRangeSelection(selection) &&
  selection.isCollapsed() &&
  selection.anchor.type === 'element' &&
  $isRootNode(selection.anchor.getNode());

/**
 * Move a root-level caret into a real block. Prefers an adjacent element
 * (no content change); otherwise pushes a fresh empty paragraph into the gap
 * so the caret has a home — the same "顶出一行空行" behaviour Linear has.
 */
const $repairRootLevelCaret = (offset: number) => {
  const root = $getRoot();
  const next = root.getChildAtIndex(offset);
  const prev = offset > 0 ? root.getChildAtIndex(offset - 1) : null;

  if ($isElementNode(next)) {
    next.selectStart();
    return;
  }
  if ($isElementNode(prev)) {
    prev.selectEnd();
    return;
  }

  const paragraph = $createParagraphNode();
  if (next) next.insertBefore(paragraph);
  else if (prev) prev.insertAfter(paragraph);
  else root.append(paragraph);
  paragraph.select();
};

export const registerBlockDecoratorCaretGuardOnLexical = (lexicalEditor: LexicalEditor) =>
  lexicalEditor.registerUpdateListener(({ editorState }) => {
    if (!lexicalEditor.isEditable()) return;

    let offset: number | null = null;
    editorState.read(() => {
      const selection = $getSelection();
      if ($isRootLevelCollapsedSelection(selection)) offset = selection.anchor.offset;
    });
    if (offset === null) return;

    const rootOffset = offset;
    lexicalEditor.update(
      () => {
        // Re-validate inside the update: another listener may have already moved the caret.
        const selection = $getSelection();
        if (!$isRootLevelCollapsedSelection(selection)) return;
        $repairRootLevelCaret(rootOffset);
      },
      { tag: HISTORY_MERGE_TAG },
    );
  });

/**
 * Keep the caret out of the root node around block decorators (block images,
 * hr, …). Two user-visible symptoms this fixes:
 *
 * 1. Inserting / pasting a block image on an empty line: Lexical's
 *    `insertNodes` drops the empty paragraph and calls `selectEnd()` on the
 *    decorator, which resolves to a root-level point → horizontal caret.
 * 2. Clicking left of a block image that is the first line of the document:
 *    the DOM point resolves to root offset 0 → horizontal caret.
 *
 * In both cases we push an empty paragraph next to the decorator and move the
 * caret into it (or into an existing neighbouring block when there is one).
 */
export const registerBlockDecoratorCaretGuard = (editor: IEditor): (() => void) | undefined => {
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;
  return registerBlockDecoratorCaretGuardOnLexical(lexicalEditor);
};
