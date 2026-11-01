/**
 * @vitest-environment happy-dom
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { releaseEditorSelectionOnLexical } from './releaseEditorSelection';

const commit = (editor: LexicalEditor, fn: () => void) =>
  new Promise<void>((resolve) => {
    editor.update(fn, { onUpdate: resolve });
  });

/**
 * A mounted editor whose caret sits in its body, and a title input outside it
 * that the user has moved to, as in the create-task modal after pasting an image.
 */
const setup = async () => {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  const title = document.createElement('input');
  document.body.append(title, root);

  const editor = createEditor({
    onError: (e) => {
      throw e;
    },
  });
  editor.setRootElement(root);

  let text: TextNode | undefined;
  await commit(editor, () => {
    text = $createTextNode('body');
    $getRoot().append($createParagraphNode().append(text));
    text.select(4, 4);
  });

  title.focus();
  window.getSelection()?.removeAllRanges();

  // Stands in for the image node's `setUploaded`: a later async update that
  // changes content without the user touching the editor.
  const finishUpload = () => commit(editor, () => text!.setTextContent('body!'));

  return { editor, finishUpload, root, title };
};

// Browsers move focus along with a DOM selection placed in a contenteditable;
// happy-dom does not, so the selection is what these tests can observe.
const selectionInside = (root: HTMLElement) => {
  const anchor = window.getSelection()?.anchorNode;
  return !!anchor && root.contains(anchor);
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('releaseEditorSelectionOnLexical', () => {
  it('keeps focus on the title when an upload finishes after the user left the editor', async () => {
    const { editor, finishUpload, root, title } = await setup();

    releaseEditorSelectionOnLexical(editor);
    await finishUpload();

    expect(document.activeElement).toBe(title);
    expect(selectionInside(root)).toBe(false);
  });

  it('without releasing, the same update pulls the selection back into the editor', async () => {
    const { finishUpload, root } = await setup();

    await finishUpload();

    expect(selectionInside(root)).toBe(true);
  });
});
