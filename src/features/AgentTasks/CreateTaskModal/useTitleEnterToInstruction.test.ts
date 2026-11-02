/**
 * @vitest-environment happy-dom
 */
import type { IEditor } from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useTitleEnterToInstruction } from './useTitleEnterToInstruction';

const flush = async (editor: LexicalEditor) => {
  await new Promise<void>((resolve) => {
    editor.update(() => undefined, { onUpdate: resolve });
  });
};

const readSnapshot = (editor: LexicalEditor) => {
  let lines: string[] = [];
  let caretLine: number | undefined;
  editor.getEditorState().read(() => {
    lines = $getRoot()
      .getChildren()
      .map((child) => child.getTextContent());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      caretLine = selection.anchor.getNode().getTopLevelElementOrThrow().getIndexWithinParent();
    }
  });
  return { caretLine, lines };
};

/** An instruction that already starts with content, as when an image was pasted first. */
const setup = async () => {
  const lexical = createEditor({
    onError: (e) => {
      throw e;
    },
  });
  lexical.update(() => {
    $getRoot().append($createParagraphNode().append($createTextNode('body')));
  });
  await flush(lexical);

  const focus = vi.fn();
  const editor = { focus, getLexicalEditor: () => lexical } as unknown as IEditor;
  const { result } = renderHook(() => useTitleEnterToInstruction(editor));

  return { focus, lexical, onKeyDown: result.current };
};

interface KeyInit {
  ctrlKey?: boolean;
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  metaKey?: boolean;
}

const keyDown = ({ isComposing = false, key = 'Enter', keyCode = 13, ...modifiers }: KeyInit) => {
  const preventDefault = vi.fn();
  const event = {
    ctrlKey: false,
    key,
    keyCode,
    metaKey: false,
    nativeEvent: { isComposing },
    preventDefault,
    ...modifiers,
  } as unknown as KeyboardEvent<HTMLInputElement>;
  return { event, preventDefault };
};

describe('useTitleEnterToInstruction', () => {
  it('continues into the instruction on a fresh first line', async () => {
    const { focus, lexical, onKeyDown } = await setup();
    const { event, preventDefault } = keyDown({});

    onKeyDown(event);
    await flush(lexical);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(readSnapshot(lexical)).toEqual({ caretLine: 0, lines: ['', 'body'] });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it.each<[string, KeyInit]>([
    ['another key', { key: 'a', keyCode: 65 }],
    ['Cmd+Enter, which submits', { metaKey: true }],
    ['Ctrl+Enter, which submits', { ctrlKey: true }],
    ['an Enter that confirms an IME candidate', { isComposing: true }],
    // Safari ends the composition first, so only keyCode 229 marks this Enter.
    ['the IME-confirming Enter on Safari', { keyCode: 229 }],
  ])('leaves %s alone', async (_, init) => {
    const { focus, lexical, onKeyDown } = await setup();
    const { event, preventDefault } = keyDown(init);

    onKeyDown(event);
    await flush(lexical);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(readSnapshot(lexical).lines).toEqual(['body']);
    expect(focus).not.toHaveBeenCalled();
  });
});
