// @vitest-environment happy-dom

import type { IEditor } from '@lobehub/editor';
import { getKernelFromEditorConfig } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
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

const isRegistered = (editor: IEditor) => {
  const theme = (editor.getLexicalEditor() as any)?._config?.theme;
  return !!theme && getKernelFromEditorConfig({ theme } as any) === (editor as any);
};

const rootOf = (editor: IEditor) => editor.getLexicalEditor()!.getRootElement();

const renderRealEditor = ({ lifecycle }: { lifecycle: boolean }) => {
  let captured!: IEditor;
  const Host = () => {
    const editor = useEditor();
    captured = editor;
    useEditorRootLifecycle(lifecycle ? editor : ({ getLexicalEditor: () => null } as IEditor));
    return createElement(Editor, { content: '', editor, type: 'text' });
  };
  const tree = (mode: 'hidden' | 'visible') =>
    createElement(Activity, { children: createElement(Host), mode });
  return { ...render(tree('visible')), editor: () => captured, tree };
};

describe('useEditorRootLifecycle with a real editor', () => {
  it('leaks the kernel into the global registry when the lifecycle is not applied', async () => {
    const { editor, unmount } = renderRealEditor({ lifecycle: false });
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isRegistered(editor())).toBe(true);
  });

  it('destroys the kernel on a direct visible unmount', async () => {
    const { editor, unmount } = renderRealEditor({ lifecycle: true });
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());

    unmount();
    await waitFor(() => expect(isRegistered(editor())).toBe(false));
  });

  it('detaches the root but keeps the kernel while hidden', async () => {
    const { editor, rerender, tree } = renderRealEditor({ lifecycle: true });
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());
    const root = rootOf(editor());

    rerender(tree('hidden'));
    expect(rootOf(editor())).toBeNull();
    expect(root!.isConnected).toBe(true);
    expect(isRegistered(editor())).toBe(true);
  });

  it('restores the same root to the same kernel when revealed', async () => {
    const { editor, rerender, tree } = renderRealEditor({ lifecycle: true });
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());
    const root = rootOf(editor());
    const lexicalEditor = editor().getLexicalEditor();

    rerender(tree('hidden'));
    rerender(tree('visible'));
    expect(rootOf(editor())).toBe(root);
    expect(editor().getLexicalEditor()).toBe(lexicalEditor);
    expect(isRegistered(editor())).toBe(true);
  });

  it('destroys the kernel when a hidden tree unmounts', async () => {
    const { editor, rerender, tree, unmount } = renderRealEditor({ lifecycle: true });
    await waitFor(() => expect(rootOf(editor())).toBeTruthy());

    rerender(tree('hidden'));
    unmount();
    await waitFor(() => expect(isRegistered(editor())).toBe(false));
  });

  it('destroys the kernel when the root is detached by a ref cleanup before the effect', async () => {
    let root: HTMLElement | null = null;
    const destroy = vi.fn();
    const lexicalEditor = {
      getRootElement: () => root,
      setRootElement: (next: HTMLElement | null) => {
        root = next;
      },
    };
    const editor = { destroy, getLexicalEditor: () => lexicalEditor } as unknown as IEditor;
    const Host = () => {
      useEditorRootLifecycle(editor);
      return createElement('div', {
        ref: (node: HTMLElement | null) => {
          lexicalEditor.setRootElement(node);
          return () => lexicalEditor.setRootElement(null);
        },
      });
    };

    const { unmount } = render(createElement(Host));
    unmount();
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  });
});
