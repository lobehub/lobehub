import type { IEditor } from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusOnChatSwitch } from './useFocusOnChatSwitch';

const platform = vi.hoisted(() => ({ isMobileSurface: false }));

vi.mock('@/utils/mobileSurface', () => ({
  isMobileSurface: () => platform.isMobileSurface,
}));

const createEditor = () => ({ focus: vi.fn() }) as unknown as IEditor;

describe('useFocusOnChatSwitch', () => {
  beforeEach(() => {
    platform.isMobileSurface = false;
  });

  it('focuses the editor on desktop each time the chat changes', () => {
    const editor = createEditor();
    const { rerender } = renderHook(({ chatKey }) => useFocusOnChatSwitch(editor, chatKey), {
      initialProps: { chatKey: 'topic-a' },
    });

    expect(editor.focus).toHaveBeenCalledTimes(1);

    rerender({ chatKey: 'topic-b' });

    expect(editor.focus).toHaveBeenCalledTimes(2);
  });

  it('does not focus the editor on mobile when the chat changes', () => {
    platform.isMobileSurface = true;
    const editor = createEditor();
    const { rerender } = renderHook(({ chatKey }) => useFocusOnChatSwitch(editor, chatKey), {
      initialProps: { chatKey: 'topic-a' },
    });

    rerender({ chatKey: 'topic-b' });

    expect(editor.focus).not.toHaveBeenCalled();
  });

  it('does nothing before the editor exists', () => {
    expect(() =>
      renderHook(() => useFocusOnChatSwitch(undefined, 'topic-a')),
    ).not.toThrow();
  });
});
