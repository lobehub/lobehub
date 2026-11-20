import type { IEditor } from '@lobehub/editor';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
} from 'lexical';

/**
 * Clicks on the blank space around the page body, the way AFFiNE's page root
 * handles them:
 * - below the last block: continue writing at the end — on the trailing empty
 *   line if there is one, otherwise on a new one, so a document that ends in a
 *   table, code block or image can still be written after;
 * - beside a line (the page margins): put the caret at that line's start
 *   (left margin) or end (right margin);
 * - above the body (beside the title, on a banner): nothing.
 */

export type BlankZone = 'above' | 'beside' | 'below';

interface ClickPoint {
  clientX: number;
  clientY: number;
}

/** Exported for tests. */
export const getBlankZone = (
  { bodyTop, contentBottom }: { bodyTop: number; contentBottom: number },
  clientY: number,
): BlankZone => {
  if (clientY < bodyTop) return 'above';
  if (clientY > contentBottom) return 'below';
  return 'beside';
};

/**
 * Select the line to write on at the end of the document: the trailing empty
 * paragraph, or a new one appended after whatever the document ends with.
 */
export const $selectDocumentEndForWriting = () => {
  const root = $getRoot();
  const last = root.getLastChild();
  if ($isParagraphNode(last) && last.getChildrenSize() === 0) {
    last.select();
    return;
  }

  const paragraph = $createParagraphNode();
  root.append(paragraph);
  paragraph.select();
};

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const selectDocumentEndForWritingOnLexical = (lexicalEditor: LexicalEditor) => {
  lexicalEditor.update($selectDocumentEndForWriting);
};

const getBlockElements = (root: HTMLElement) =>
  [...root.children].filter((child): child is HTMLElement => child instanceof HTMLElement);

const getContentBottom = (root: HTMLElement) => {
  const blocks = getBlockElements(root);
  const last = blocks.at(-1);
  return last ? last.getBoundingClientRect().bottom : root.getBoundingClientRect().top;
};

/** The top-level block whose rows span `clientY`, else the one closest to it. */
const findBlockElementAt = (root: HTMLElement, clientY: number) => {
  let nearest: HTMLElement | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const block of getBlockElements(root)) {
    const { bottom, top } = block.getBoundingClientRect();
    if (clientY >= top && clientY <= bottom) return block;

    const distance = clientY < top ? top - clientY : clientY - bottom;
    if (distance < nearestDistance) {
      nearest = block;
      nearestDistance = distance;
    }
  }

  return nearest;
};

type DocumentWithCaretApi = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const getCaretPointFromPoint = (x: number, y: number) => {
  const doc = document as DocumentWithCaretApi;
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
};

/**
 * Put the caret at the start or end of the line beside the click. The text
 * position the browser reports at the body's edge is the start / end of that
 * visual line; when there is none (an image row, a browser without the caret
 * API) the whole block's start / end is used instead.
 */
const selectLineBesidePoint = (
  lexicalEditor: LexicalEditor,
  root: HTMLElement,
  { clientX, clientY }: ClickPoint,
) => {
  const rootRect = root.getBoundingClientRect();
  const side = clientX < rootRect.left + rootRect.width / 2 ? 'start' : 'end';
  const edgeX = side === 'start' ? rootRect.left + 1 : rootRect.right - 1;
  const caretPoint = getCaretPointFromPoint(edgeX, clientY);
  const blockElement = findBlockElementAt(root, clientY);

  lexicalEditor.update(() => {
    if (
      caretPoint &&
      caretPoint.node.nodeType === Node.TEXT_NODE &&
      root.contains(caretPoint.node)
    ) {
      const textNode = $getNearestNodeFromDOMNode(caretPoint.node);
      if ($isTextNode(textNode)) {
        const offset = Math.min(caretPoint.offset, textNode.getTextContentSize());
        textNode.select(offset, offset);
        return;
      }
    }

    if (!blockElement) return;
    const block = $getNearestNodeFromDOMNode(blockElement);
    if ($isElementNode(block)) {
      if (side === 'start') block.selectStart();
      else block.selectEnd();
      return;
    }
    if ($isDecoratorNode(block)) {
      const selection = $createNodeSelection();
      selection.add(block.getKey());
      $setSelection(selection);
    }
  });
};

/**
 * Handle a click on the page's blank layout space at `point`. A no-op unless
 * the body is editable.
 */
export const focusEditorAtBlankPoint = (editor: IEditor | undefined, point: ClickPoint) => {
  const lexicalEditor = editor?.getLexicalEditor?.();
  const root = lexicalEditor?.getRootElement();
  if (!lexicalEditor || !root || !lexicalEditor.isEditable()) return;

  const zone = getBlankZone(
    { bodyTop: root.getBoundingClientRect().top, contentBottom: getContentBottom(root) },
    point.clientY,
  );

  if (zone === 'above') return;

  if (zone === 'below') selectDocumentEndForWritingOnLexical(lexicalEditor);
  else selectLineBesidePoint(lexicalEditor, root, point);

  lexicalEditor.focus();
};

/**
 * Inside the editor itself, a press on the body's own blank area below its
 * last block (the root, or the padded wrapper around it) would leave the caret
 * wherever the browser snaps it — inside a trailing table cell, or nowhere
 * after an image. Continue writing at the end instead.
 */
export const registerClickBelowContentOnLexical = (lexicalEditor: LexicalEditor) => {
  let attached: { host: HTMLElement; root: HTMLElement } | null = null;

  const onMouseDown = (event: MouseEvent) => {
    const root = attached?.root;
    if (!root || !lexicalEditor.isEditable()) return;
    if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
      return;
    if (event.target !== root && event.target !== root.parentElement) return;
    if (event.clientY <= getContentBottom(root)) return;

    // Keep the browser from snapping a caret (or starting a drag selection)
    // from the blank area; the caret goes to the end line instead.
    event.preventDefault();
    selectDocumentEndForWritingOnLexical(lexicalEditor);
    lexicalEditor.focus();
  };

  const detach = () => {
    attached?.host.removeEventListener('mousedown', onMouseDown);
    attached = null;
  };

  const unregisterRootListener = lexicalEditor.registerRootListener((root) => {
    detach();
    const host = root?.parentElement;
    if (!root || !host) return;
    host.addEventListener('mousedown', onMouseDown);
    attached = { host, root };
  });

  return () => {
    unregisterRootListener();
    detach();
  };
};
