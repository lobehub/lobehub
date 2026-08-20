import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type ChatInputEditor } from '@/features/ChatInput';

import { useExposeMainEditor } from './useExposeMainEditor';

const createEditor = () => ({ focus: () => {} }) as ChatInputEditor;

describe('useExposeMainEditor', () => {
  afterEach(() => {
    window.__mainEditor = undefined;
  });

  it('mounts the editor on window', () => {
    const editor = createEditor();
    renderHook(() => useExposeMainEditor(editor));

    expect(window.__mainEditor).toBe(editor);
  });

  it('leaves window untouched while the editor is not ready', () => {
    renderHook(() => useExposeMainEditor(null));

    expect(window.__mainEditor).toBeUndefined();
  });

  it('clears the handle on unmount so a stale editor is never exposed', () => {
    const editor = createEditor();
    const { unmount } = renderHook(() => useExposeMainEditor(editor));
    expect(window.__mainEditor).toBe(editor);

    unmount();

    expect(window.__mainEditor).toBeUndefined();
  });
});
