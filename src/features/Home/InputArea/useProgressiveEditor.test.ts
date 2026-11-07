import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  type HomeEditorInputComponent,
  type HomeEditorInputLoader,
  useProgressiveEditor,
} from './useProgressiveEditor';

describe('useProgressiveEditor', () => {
  it('waits for an active IME composition before replacing the fallback', async () => {
    let resolveEditor!: (module: { default: HomeEditorInputComponent }) => void;
    const loadEditor: HomeEditorInputLoader = vi.fn(
      () =>
        new Promise<{ default: HomeEditorInputComponent }>((resolve) => {
          resolveEditor = resolve;
        }),
    );
    const LoadedEditor: HomeEditorInputComponent = () => null;
    const { result } = renderHook(() => useProgressiveEditor(loadEditor));

    act(() => result.current.startComposition());

    await act(async () => {
      resolveEditor({ default: LoadedEditor });
      await Promise.resolve();
    });

    expect(result.current.EditorInput).toBe(LoadedEditor);
    expect(result.current.canRenderEditor).toBe(false);

    act(() => result.current.endComposition());

    expect(result.current.canRenderEditor).toBe(true);
  });
});
