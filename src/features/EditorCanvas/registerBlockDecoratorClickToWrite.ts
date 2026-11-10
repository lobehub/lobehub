import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  type DecoratorNode,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  mergeRegister,
} from 'lexical';

const $isBlockDecorator = (node: LexicalNode | null | undefined): node is DecoratorNode<unknown> =>
  $isDecoratorNode(node) && !node.isInline();

/**
 * Put the caret at the start of the line after a block decorator, opening an
 * empty line there when the next block is not a text line.
 */
export const $selectLineAfterBlockDecorator = (decorator: LexicalNode): void => {
  const next = decorator.getNextSibling();
  if ($isElementNode(next) && !next.isInline()) {
    next.selectStart();
    return;
  }

  const paragraph = $createParagraphNode();
  decorator.insertAfter(paragraph);
  paragraph.selectStart();
};

/** The one block decorator a node selection holds, if that is all it holds. */
const $getSelectedBlockDecorator = (): DecoratorNode<unknown> | null => {
  const selection = $getSelection();
  if (!$isNodeSelection(selection)) return null;
  const nodes = selection.getNodes();
  return nodes.length === 1 && $isBlockDecorator(nodes[0]) ? nodes[0] : null;
};

/** A key that starts writing text: a printable character, or an IME composition. */
const isWritingKey = (event: KeyboardEvent): boolean => {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.isComposing || event.keyCode === 229 || event.key === 'Process') return true;
  return event.key.length === 1;
};

/** Exported for tests, which drive a bare Lexical editor without the kernel. */
export const registerBlockDecoratorClickToWriteOnLexical = (lexicalEditor: LexicalEditor) => {
  const onClick = (event: MouseEvent) => {
    if (!lexicalEditor.isEditable() || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const decoratorElement = target.closest('[data-lexical-decorator]');
    const rootElement = lexicalEditor.getRootElement();
    if (!decoratorElement || !rootElement || decoratorElement.parentElement !== rootElement) return;

    // The decorator is contenteditable=false, so the click neither focuses the
    // editor nor moves the browser caret: a caret left in another field (the
    // task title) keeps receiving the keys typed next. Take both over here.
    if (document.activeElement !== rootElement) rootElement.focus({ preventScroll: true });
    const domSelection = window.getSelection();
    if (domSelection?.anchorNode && !rootElement.contains(domSelection.anchorNode)) {
      domSelection.removeAllRanges();
    }

    // A click on the block itself (the image) keeps selecting it. A click on
    // the blank part of its row means "write here": continue on the next line.
    if (target !== decoratorElement) return;
    lexicalEditor.update(() => {
      const node = $getNearestNodeFromDOMNode(decoratorElement);
      if ($isBlockDecorator(node)) $selectLineAfterBlockDecorator(node);
    });
  };

  // Text that arrives without a writing keydown first (autofill-like input,
  // some IME paths) would also be dropped on a selected image; write it on
  // the line after the image instead.
  const onBeforeInput = (event: InputEvent) => {
    if (event.inputType !== 'insertText' || !event.data) return;
    const data = event.data;
    // A non-cancelable insert (IME commit) is written by the browser anyway, at
    // the caret we move here; only a cancelable one is ours to write.
    const writeHere = event.cancelable;
    let handled = false;
    lexicalEditor.update(
      () => {
        const decorator = $getSelectedBlockDecorator();
        if (!decorator) return;
        handled = true;
        $selectLineAfterBlockDecorator(decorator);
        const selection = $getSelection();
        if (writeHere && $isRangeSelection(selection)) selection.insertText(data);
      },
      { discrete: true },
    );
    if (!handled || !writeHere) return;
    // Lexical's own before-input handler would queue the same text again.
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  return mergeRegister(
    lexicalEditor.registerRootListener((rootElement, prevRootElement) => {
      // Capture: the image stops the click from bubbling up to the root, and
      // the before-input fallback must run before Lexical's own handler.
      prevRootElement?.removeEventListener('click', onClick, true);
      prevRootElement?.removeEventListener('beforeinput', onBeforeInput, true);
      rootElement?.addEventListener('click', onClick, true);
      rootElement?.addEventListener('beforeinput', onBeforeInput, true);
    }),
    // Typing while a block image is selected would otherwise write nothing:
    // a node selection has no caret. Move the caret to the line after it before
    // the browser turns the key into input, so plain keys and IME input both
    // land there through the editor's normal input path.
    lexicalEditor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!isWritingKey(event) || !$getSelectedBlockDecorator()) return false;
        queueMicrotask(() => {
          lexicalEditor.update(
            () => {
              const decorator = $getSelectedBlockDecorator();
              if (decorator) $selectLineAfterBlockDecorator(decorator);
            },
            { discrete: true },
          );
        });
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
  );
};

/**
 * Let a click anywhere in a block image's row lead to writing:
 *
 * 1. The click takes focus and the browser caret from whatever field had them,
 *    so keys no longer go back to e.g. the task title (T-2690).
 * 2. A click beside the image puts the caret on the line after it.
 * 3. Typing while the image itself is selected continues on the line after it.
 */
export const registerBlockDecoratorClickToWrite = (editor: IEditor): (() => void) | undefined => {
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;
  return registerBlockDecoratorClickToWriteOnLexical(lexicalEditor);
};
