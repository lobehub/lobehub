import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuickNoteStore } from '@/store/quickNote';

import { useNoteContentSync } from './useNoteContentSync';

const updateNoteContentMock = vi.hoisted(() => vi.fn());

describe('useNoteContentSync', () => {
  beforeEach(() => {
    updateNoteContentMock.mockClear();
    useQuickNoteStore.setState({ updateNoteContent: updateNoteContentMock });
  });

  it('returns a callback that persists the current editor document through updateNoteContent', () => {
    const editor = {
      getDocument: (format: string) => (format === 'markdown' ? 'updated markdown' : { rev: 1 }),
    } as never;

    const { result } = renderHook(() => useNoteContentSync('n1', editor));
    result.current();

    expect(updateNoteContentMock).toHaveBeenCalledWith('n1', 'updated markdown', { rev: 1 });
  });

  it('reads the latest editor content at call time, not at render time', () => {
    let markdown = 'first';
    const editor = {
      getDocument: (format: string) => (format === 'markdown' ? markdown : {}),
    } as never;

    const { result } = renderHook(() => useNoteContentSync('n1', editor));
    markdown = 'second';
    result.current();

    expect(updateNoteContentMock).toHaveBeenCalledWith('n1', 'second', {});
  });
});
