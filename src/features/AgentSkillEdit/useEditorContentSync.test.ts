import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorContentSync } from './useEditorContentSync';

describe('useEditorContentSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the stale content sync when content changes', () => {
    const editor = { setDocument: vi.fn() };
    const { rerender } = renderHook(({ content }) => useEditorContentSync(editor, content), {
      initialProps: { content: 'old content' },
    });

    rerender({ content: 'new content' });
    vi.advanceTimersByTime(100);

    expect(editor.setDocument).toHaveBeenCalledOnce();
    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'new content');
  });

  it('cancels the pending content sync on unmount', () => {
    const editor = { setDocument: vi.fn() };
    const { unmount } = renderHook(() => useEditorContentSync(editor, 'content'));

    unmount();
    vi.advanceTimersByTime(100);

    expect(editor.setDocument).not.toHaveBeenCalled();
  });
});
