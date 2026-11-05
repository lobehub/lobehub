/**
 * @vitest-environment happy-dom
 */
import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  DecoratorNode,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import {
  focusEditorAtBlankPoint,
  getBlankZone,
  registerClickBelowContentOnLexical,
  selectDocumentEndForWritingOnLexical,
} from './blankAreaClick';

class FakeImageNode extends DecoratorNode<null> {
  static getType() {
    return 'fake-image';
  }

  static clone(node: FakeImageNode) {
    return new FakeImageNode(node.__key);
  }

  static importJSON() {
    return new FakeImageNode();
  }

  isInline() {
    return false;
  }

  createDOM() {
    return document.createElement('div');
  }

  updateDOM() {
    return false;
  }

  decorate() {
    return null;
  }
}

const commit = (editor: LexicalEditor, fn: () => void) =>
  new Promise<void>((resolve) => {
    editor.update(fn, { onUpdate: resolve });
  });

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  document.body.innerHTML = '';
});

type Line = string | 'image';

const setup = async (lines: Line[]) => {
  const wrapper = document.createElement('div');
  const root = document.createElement('div');
  root.contentEditable = 'true';
  wrapper.append(root);
  document.body.append(wrapper);

  const editor = createEditor({
    nodes: [FakeImageNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(root);
  cleanups.push(() => editor.setRootElement(null));

  await commit(editor, () => {
    $getRoot().append(
      ...lines.map((line) => {
        if (line === 'image') return new FakeImageNode();
        const paragraph = $createParagraphNode();
        if (line) paragraph.append($createTextNode(line));
        return paragraph;
      }),
    );
  });

  // jsdom-like environments have no layout: the body spans x 0–600 and
  // y 100–(100 + 20 per line), one 20px row per block.
  root.getBoundingClientRect = () =>
    ({ bottom: 100 + lines.length * 20, left: 0, right: 600, top: 100, width: 600 }) as DOMRect;
  [...root.children].forEach((child, index) => {
    (child as HTMLElement).getBoundingClientRect = () =>
      ({ bottom: 120 + index * 20, top: 100 + index * 20 }) as DOMRect;
  });

  return { editor, root, wrapper };
};

const readState = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    return {
      caret: $isRangeSelection(selection)
        ? {
            line: selection.anchor.getNode().getTopLevelElementOrThrow().getIndexWithinParent(),
            offset: selection.anchor.offset,
          }
        : null,
      lines: $getRoot()
        .getChildren()
        .map((child) => (child instanceof FakeImageNode ? 'image' : child.getTextContent())),
    };
  });

const asKernel = (editor: LexicalEditor) => ({ getLexicalEditor: () => editor }) as IEditor;

describe('getBlankZone', () => {
  const bounds = { bodyTop: 100, contentBottom: 300 };

  it('tells above, beside and below the body apart', () => {
    expect(getBlankZone(bounds, 50)).toBe('above');
    expect(getBlankZone(bounds, 200)).toBe('beside');
    expect(getBlankZone(bounds, 301)).toBe('below');
  });
});

describe('selectDocumentEndForWritingOnLexical', () => {
  it('puts the caret on a trailing empty line instead of adding another', async () => {
    const { editor } = await setup(['text', '']);

    selectDocumentEndForWritingOnLexical(editor);
    await settle();

    expect(readState(editor)).toEqual({ caret: { line: 1, offset: 0 }, lines: ['text', ''] });
  });

  it('opens a new line after a document that ends in text', async () => {
    const { editor } = await setup(['text']);

    selectDocumentEndForWritingOnLexical(editor);
    await settle();

    expect(readState(editor)).toEqual({ caret: { line: 1, offset: 0 }, lines: ['text', ''] });
  });

  it('opens a new line after a document that ends in a block image', async () => {
    const { editor } = await setup(['text', 'image']);

    selectDocumentEndForWritingOnLexical(editor);
    await settle();

    expect(readState(editor)).toEqual({
      caret: { line: 2, offset: 0 },
      lines: ['text', 'image', ''],
    });
  });
});

describe('registerClickBelowContentOnLexical', () => {
  const pressAt = (target: Element, clientY: number, init: MouseEventInit = {}) => {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientY,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };

  it('continues writing at the end from a press below the last block', async () => {
    const { editor, wrapper } = await setup(['text', 'image']);
    cleanups.push(registerClickBelowContentOnLexical(editor));

    const event = pressAt(wrapper, 200);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(readState(editor)).toEqual({
      caret: { line: 2, offset: 0 },
      lines: ['text', 'image', ''],
    });
  });

  it('also handles a press on the editable root itself below its content', async () => {
    const { editor, root } = await setup(['text']);
    cleanups.push(registerClickBelowContentOnLexical(editor));

    expect(pressAt(root, 200).defaultPrevented).toBe(true);
    await settle();

    expect(readState(editor).lines).toEqual(['text', '']);
  });

  it('leaves presses within the content to the browser', async () => {
    const { editor, root, wrapper } = await setup(['text']);
    cleanups.push(registerClickBelowContentOnLexical(editor));

    expect(pressAt(wrapper, 110).defaultPrevented).toBe(false);
    expect(pressAt(root.firstElementChild!, 200).defaultPrevented).toBe(false);
    expect(pressAt(wrapper, 200, { shiftKey: true }).defaultPrevented).toBe(false);
    await settle();

    expect(readState(editor).lines).toEqual(['text']);
  });

  it('does nothing on a read-only body', async () => {
    const { editor, wrapper } = await setup(['text']);
    cleanups.push(registerClickBelowContentOnLexical(editor));
    editor.setEditable(false);

    expect(pressAt(wrapper, 200).defaultPrevented).toBe(false);
    await settle();

    expect(readState(editor).lines).toEqual(['text']);
  });

  it('stops listening once unregistered', async () => {
    const { editor, wrapper } = await setup(['text']);
    registerClickBelowContentOnLexical(editor)();

    expect(pressAt(wrapper, 200).defaultPrevented).toBe(false);
  });
});

describe('focusEditorAtBlankPoint', () => {
  it('continues writing at the end from a click below the body', async () => {
    const { editor } = await setup(['first', 'second']);

    focusEditorAtBlankPoint(asKernel(editor), { clientX: 300, clientY: 400 });
    await settle();

    expect(readState(editor)).toEqual({
      caret: { line: 2, offset: 0 },
      lines: ['first', 'second', ''],
    });
  });

  it('puts the caret at the start of the line beside a left-margin click', async () => {
    const { editor } = await setup(['first', 'second']);

    focusEditorAtBlankPoint(asKernel(editor), { clientX: -40, clientY: 130 });
    await settle();

    expect(readState(editor)).toEqual({
      caret: { line: 1, offset: 0 },
      lines: ['first', 'second'],
    });
  });

  it('puts the caret at the end of the line beside a right-margin click', async () => {
    const { editor } = await setup(['first', 'second']);

    focusEditorAtBlankPoint(asKernel(editor), { clientX: 640, clientY: 110 });
    await settle();

    expect(readState(editor)).toEqual({
      caret: { line: 0, offset: 5 },
      lines: ['first', 'second'],
    });
  });

  it('ignores clicks above the body, beside the title', async () => {
    const { editor } = await setup(['first']);
    await commit(editor, () => {
      $getRoot().getFirstChildOrThrow().selectEnd();
    });

    focusEditorAtBlankPoint(asKernel(editor), { clientX: -40, clientY: 40 });
    await settle();

    expect(readState(editor)).toEqual({ caret: { line: 0, offset: 5 }, lines: ['first'] });
  });

  it('does nothing on a read-only body', async () => {
    const { editor } = await setup(['first']);
    editor.setEditable(false);

    focusEditorAtBlankPoint(asKernel(editor), { clientX: 300, clientY: 400 });
    await settle();

    expect(readState(editor).lines).toEqual(['first']);
  });
});
