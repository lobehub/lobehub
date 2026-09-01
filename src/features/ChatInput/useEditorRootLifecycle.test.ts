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
  it('restores a hidden root to its owning editor and destroys it only after unmount', async () => {
    let ownerRoot: HTMLElement | null = null;
    let replacementRoot: HTMLElement | null = document.createElement('div');
    const destroy = vi.fn();
    const ownerSetRootElement = vi.fn((root: HTMLElement | null) => {
      ownerRoot = root;
    });
    const ownerLexicalEditor = {
      getRootElement: vi.fn(() => ownerRoot),
      setRootElement: ownerSetRootElement,
    };
    const replacementSetRootElement = vi.fn((root: HTMLElement | null) => {
      replacementRoot = root;
    });
    const replacementLexicalEditor = {
      getRootElement: vi.fn(() => replacementRoot),
      setRootElement: replacementSetRootElement,
    };
    const editor = {
      destroy,
      getLexicalEditor: vi
        .fn()
        .mockReturnValueOnce(ownerLexicalEditor)
        .mockReturnValue(replacementLexicalEditor),
    } as unknown as IEditor;
    const rootRef = (root: HTMLDivElement | null) => {
      if (root) ownerRoot = root;
    };
    const tree = (mode: 'hidden' | 'visible') =>
      createElement(Activity, { children: createElement(Probe, { editor, rootRef }), mode });

    const { rerender, unmount } = render(tree('visible'));
    const element = ownerRoot;

    rerender(tree('hidden'));
    expect(ownerSetRootElement).toHaveBeenLastCalledWith(null);
    expect(destroy).not.toHaveBeenCalled();

    rerender(tree('visible'));
    expect(ownerSetRootElement).toHaveBeenLastCalledWith(element);
    expect(replacementSetRootElement).not.toHaveBeenCalled();
    expect(editor.getLexicalEditor).toHaveBeenCalledOnce();

    rerender(tree('hidden'));
    unmount();
    expect(ownerSetRootElement).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  });
});
