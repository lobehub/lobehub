// @vitest-environment happy-dom

import type { IEditor } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { render, waitFor } from '@testing-library/react';
import { Activity, createElement } from 'react';
import { describe, expect, it } from 'vitest';

const renderEditor = () => {
  let captured!: IEditor;
  const Host = () => {
    const editor = useEditor();
    captured = editor;
    return createElement(Editor, { content: 'x'.repeat(5000), editor, type: 'text' });
  };
  const tree = (mode: 'hidden' | 'visible') =>
    createElement(Activity, { children: createElement(Host), mode });

  return {
    ...render(tree('visible')),
    editor: () => captured,
    release: () => {
      captured = undefined as unknown as IEditor;
    },
    tree,
  };
};

const rootOf = (editor: IEditor) => editor.getLexicalEditor()!.getRootElement();

const collect = async () => {
  for (let index = 0; index < 6; index++) {
    globalThis.gc!();
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

describe('ChatInput editor lifecycle', () => {
  it('restores the same root and lexical editor when a hidden tree is revealed', async () => {
    const { editor, rerender, tree } = renderEditor();
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());
    const root = rootOf(editor());
    const lexicalEditor = editor().getLexicalEditor();

    rerender(tree('hidden'));
    rerender(tree('visible'));

    expect(rootOf(editor())).toBe(root);
    expect(editor().getLexicalEditor()).toBe(lexicalEditor);
  });

  it.skipIf(!globalThis.gc)('releases the editor after a hidden tree unmounts', async () => {
    const { editor, release, rerender, tree, unmount, container } = renderEditor();
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());
    const kernelRef = new WeakRef(editor() as object);
    const lexicalRef = new WeakRef(editor().getLexicalEditor() as object);
    const rootRef = new WeakRef(rootOf(editor()) as object);

    rerender(tree('hidden'));
    unmount();
    container.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await collect();

    expect(kernelRef.deref()).toBeUndefined();
    expect(lexicalRef.deref()).toBeUndefined();
    expect(rootRef.deref()).toBeUndefined();
  });
});
