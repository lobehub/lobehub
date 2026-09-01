// @vitest-environment happy-dom

import type { IEditor } from '@lobehub/editor';
import { render, waitFor } from '@testing-library/react';
import { Activity, createElement, type Ref } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useEditorRootLifecycle } from './useEditorRootLifecycle';

const Probe = ({ editor, rootRef }: { editor: IEditor; rootRef: Ref<HTMLDivElement> }) => {
  useEditorRootLifecycle(editor);
  return createElement('div', { ref: rootRef });
};

describe('useEditorRootLifecycle', () => {
  it('preserves a hidden editor and destroys it only after its root unmounts', async () => {
    let currentRoot: HTMLElement | null = null;
    const destroy = vi.fn();
    const setRootElement = vi.fn((root: HTMLElement | null) => {
      currentRoot = root;
    });
    const lexicalEditor = {
      getRootElement: vi.fn(() => currentRoot),
      setRootElement,
    };
    const editor = {
      destroy,
      getLexicalEditor: vi.fn(() => lexicalEditor),
    } as unknown as IEditor;
    const rootRef = (root: HTMLDivElement | null) => {
      if (root) currentRoot = root;
    };
    const tree = (mode: 'hidden' | 'visible') =>
      createElement(Activity, { children: createElement(Probe, { editor, rootRef }), mode });

    const { rerender, unmount } = render(tree('visible'));
    const element = currentRoot;

    rerender(tree('hidden'));
    expect(setRootElement).toHaveBeenLastCalledWith(null);
    expect(destroy).not.toHaveBeenCalled();

    rerender(tree('visible'));
    expect(setRootElement).toHaveBeenLastCalledWith(element);

    rerender(tree('hidden'));
    unmount();
    expect(setRootElement).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  });
});
