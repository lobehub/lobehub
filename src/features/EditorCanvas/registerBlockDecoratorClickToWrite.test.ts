/**
 * @vitest-environment happy-dom
 */
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  createEditor,
  DecoratorNode,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { registerBlockDecoratorClickToWriteOnLexical } from './registerBlockDecoratorClickToWrite';

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
    const wrapper = document.createElement('div');
    wrapper.append(document.createElement('img'));
    return wrapper;
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

/** Let queued microtasks and follow-up updates settle. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * The create-task modal after pasting an image: the body holds only the image
 * (and optionally a line after it), and the user has moved on to the title.
 */
const setup = async ({ lineAfter = false } = {}) => {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  const title = document.createElement('input');
  document.body.append(title, root);

  const editor = createEditor({
    nodes: [FakeImageNode],
    onError: (e) => {
      throw e;
    },
  });
  editor.setRootElement(root);
  registerBlockDecoratorClickToWriteOnLexical(editor);

  let imageKey = '';
  await commit(editor, () => {
    const image = new FakeImageNode();
    imageKey = image.getKey();
    $getRoot().append(image);
    if (lineAfter) $getRoot().append($createParagraphNode().append($createTextNode('after')));
  });

  title.focus();
  title.select();

  const imageWrapper = root.querySelector('[data-lexical-decorator]') as HTMLElement;
  return { editor, imageKey, imageWrapper, root, title };
};

const selectImage = (editor: LexicalEditor, key: string) =>
  commit(editor, () => {
    const selection = $createNodeSelection();
    selection.add(key);
    $setSelection(selection);
  });

const readBody = (editor: LexicalEditor) => {
  let types: string[] = [];
  let caret: { offset: number; text: string; type: string } | undefined;
  let texts: string[] = [];
  editor.getEditorState().read(() => {
    const children = $getRoot().getChildren();
    types = children.map((child) => child.getType());
    texts = children.map((child) => child.getTextContent());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const block = selection.anchor.getNode().getTopLevelElementOrThrow();
      caret = {
        offset: selection.anchor.offset,
        text: block.getTextContent(),
        type: block.getType(),
      };
    }
  });
  return { caret, texts, types };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('registerBlockDecoratorClickToWriteOnLexical', () => {
  it('a click beside the image opens a line after it and takes focus from the title', async () => {
    const { editor, imageWrapper, root } = await setup();

    imageWrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();

    expect(document.activeElement).toBe(root);
    expect(readBody(editor)).toMatchObject({
      caret: { text: '', type: 'paragraph' },
      types: ['fake-image', 'paragraph'],
    });
  });

  it('a click beside the image reuses the line already after it', async () => {
    const { editor, imageWrapper } = await setup({ lineAfter: true });

    imageWrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();

    expect(readBody(editor)).toMatchObject({
      caret: { offset: 0, text: 'after' },
      types: ['fake-image', 'paragraph'],
    });
  });

  // The real image stops the click from bubbling, so only a capture listener
  // on the root sees it. Without taking focus, keys kept going to the title.
  it('a click on the image itself still takes focus even when the image stops the click', async () => {
    const { editor, imageWrapper, root } = await setup();
    const img = imageWrapper.querySelector('img')!;
    img.addEventListener('click', (e) => e.stopPropagation());

    img.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();

    expect(document.activeElement).toBe(root);
    // The image stays the thing selected; no line is opened by the click itself.
    expect(readBody(editor).types).toEqual(['fake-image']);
  });

  it('typing a character while the image is selected continues on the line after it', async () => {
    const { editor, imageKey, root } = await setup();
    await selectImage(editor, imageKey);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    await settle();

    expect(readBody(editor)).toMatchObject({
      caret: { text: '', type: 'paragraph' },
      types: ['fake-image', 'paragraph'],
    });
  });

  it('starting an IME composition while the image is selected also moves the caret', async () => {
    const { editor, imageKey, root } = await setup();
    await selectImage(editor, imageKey);

    root.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Process', keyCode: 229 }),
    );
    await settle();

    expect(readBody(editor).caret?.type).toBe('paragraph');
  });

  it('leaves shortcuts and deletion keys to the editor', async () => {
    const { editor, imageKey, root } = await setup();
    await selectImage(editor, imageKey);

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'c', metaKey: true }));
    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift' }));
    await settle();

    expect(readBody(editor)).toMatchObject({ caret: undefined, types: ['fake-image'] });
  });

  it('writes inserted text that arrives without a keydown on the line after the image, once', async () => {
    const { editor, imageKey, root } = await setup();
    await selectImage(editor, imageKey);

    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '中',
      inputType: 'insertText',
    });
    let reachedLexical = false;
    root.addEventListener('beforeinput', () => (reachedLexical = true));
    root.dispatchEvent(event);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(reachedLexical).toBe(false);
    expect(readBody(editor)).toMatchObject({
      caret: { offset: 1, text: '中' },
      texts: ['', '中'],
    });
  });

  it('does nothing to typing when no image is selected', async () => {
    const { editor, root } = await setup({ lineAfter: true });
    await commit(editor, () => $getRoot().getLastChildOrThrow().selectEnd());

    root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    await settle();

    expect(readBody(editor)).toMatchObject({
      caret: { offset: 5, text: 'after' },
      types: ['fake-image', 'paragraph'],
    });
  });
});
