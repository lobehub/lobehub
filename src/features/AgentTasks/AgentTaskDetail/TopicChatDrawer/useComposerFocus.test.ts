import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useComposerFocus } from './useComposerFocus';

const createEditor = () => ({ focus: vi.fn() });

describe('useComposerFocus', () => {
  it('should start expanded without taking focus when the host only pins it open', () => {
    const editor = createEditor();
    const { result } = renderHook(() => useComposerFocus({ defaultExpanded: true, editor }));

    act(() => result.current.handleEditorInit(editor));

    expect(result.current.expanded).toBe(true);
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it('should start expanded and focus once the editor is ready when opened with a focus request', () => {
    const editor = createEditor();
    const { result } = renderHook(() =>
      useComposerFocus({ defaultExpanded: false, editor, focusRequest: 1 }),
    );
    editor.focus.mockClear();

    act(() => result.current.handleEditorInit(editor));

    expect(result.current.expanded).toBe(true);
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it('should focus after the user expands the collapsed composer', () => {
    const editor = createEditor();
    const { result } = renderHook(() => useComposerFocus({ defaultExpanded: false, editor }));
    expect(result.current.expanded).toBe(false);

    act(() => result.current.expand());
    act(() => result.current.handleEditorInit(editor));

    expect(result.current.expanded).toBe(true);
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it('should expand and focus a mounted composer when a focus request arrives', () => {
    const editor = createEditor();
    const { rerender, result } = renderHook(
      ({ focusRequest }: { focusRequest?: number }) =>
        useComposerFocus({ defaultExpanded: false, editor, focusRequest }),
      { initialProps: {} },
    );
    expect(result.current.expanded).toBe(false);

    rerender({ focusRequest: 1 });

    expect(result.current.expanded).toBe(true);
    expect(editor.focus).toHaveBeenCalled();
  });

  it('should re-expand and refocus on a repeated request after the user collapsed it', () => {
    const editor = createEditor();
    const { rerender, result } = renderHook(
      ({ focusRequest }: { focusRequest?: number }) =>
        useComposerFocus({ defaultExpanded: false, editor, focusRequest }),
      { initialProps: { focusRequest: 1 } },
    );
    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    editor.focus.mockClear();

    rerender({ focusRequest: 2 });

    expect(result.current.expanded).toBe(true);
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });
});
