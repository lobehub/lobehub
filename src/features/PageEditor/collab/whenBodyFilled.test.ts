import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { whenBodyFilled } from './whenBodyFilled';

const commit = (editor: LexicalEditor, fn: () => void) =>
  new Promise<void>((resolve) => {
    editor.update(fn, { onUpdate: resolve });
  });

const emptyEditor = async () => {
  const editor = createEditor({ onError: (error) => Promise.reject(error) });
  await commit(editor, () => $getRoot().append($createParagraphNode()));
  return editor;
};

const fill = (editor: LexicalEditor) =>
  commit(editor, () => {
    $getRoot()
      .clear()
      .append($createParagraphNode().append($createTextNode('room body')));
  });

describe('whenBodyFilled', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the update that writes the body', async () => {
    const editor = await emptyEditor();
    const onFilled = vi.fn();

    whenBodyFilled(editor, 1000, onFilled);
    await commit(editor, () => $getRoot().getFirstChild());
    expect(onFilled).not.toHaveBeenCalled();

    await fill(editor);
    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it('answers at once for a filled editor', async () => {
    const editor = await emptyEditor();
    await fill(editor);
    const onFilled = vi.fn();

    whenBodyFilled(editor, 1000, onFilled);

    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it('gives up on a page that stays empty', async () => {
    vi.useFakeTimers();
    const editor = createEditor({ onError: (error) => Promise.reject(error) });
    const onFilled = vi.fn();

    whenBodyFilled(editor, 500, onFilled);
    vi.advanceTimersByTime(499);
    expect(onFilled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it('stays silent once cancelled', async () => {
    const editor = await emptyEditor();
    const onFilled = vi.fn();

    whenBodyFilled(editor, 1000, onFilled)();
    await fill(editor);

    expect(onFilled).not.toHaveBeenCalled();
  });
});
