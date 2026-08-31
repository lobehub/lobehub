// @vitest-environment happy-dom

import type { IEditor } from '@lobehub/editor';
import { render } from '@testing-library/react';
import { Activity, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useEditorRootLifecycle } from './useEditorRootLifecycle';

const Probe = ({ editor }: { editor: IEditor }) => {
  useEditorRootLifecycle(editor);
  return null;
};

describe('useEditorRootLifecycle', () => {
  it('disconnects a hidden editor root, restores it when visible, and disconnects on unmount', () => {
    const element = document.createElement('div');
    let currentRoot: HTMLElement | null = element;
    const setRootElement = vi.fn((root: HTMLElement | null) => {
      currentRoot = root;
    });
    const lexicalEditor = {
      getRootElement: vi.fn(() => currentRoot),
      setRootElement,
    };
    const editor = {
      getLexicalEditor: vi.fn(() => lexicalEditor),
    } as unknown as IEditor;
    const tree = (mode: 'hidden' | 'visible') =>
      createElement(Activity, { children: createElement(Probe, { editor }), mode });

    const { rerender, unmount } = render(tree('visible'));

    rerender(tree('hidden'));
    expect(setRootElement).toHaveBeenLastCalledWith(null);

    rerender(tree('visible'));
    expect(setRootElement).toHaveBeenLastCalledWith(element);

    unmount();
    expect(setRootElement).toHaveBeenLastCalledWith(null);
  });
});
