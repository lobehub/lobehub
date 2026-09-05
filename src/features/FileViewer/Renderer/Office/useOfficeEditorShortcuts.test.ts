/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useOfficeEditorShortcuts } from './useOfficeEditorShortcuts';

describe('useOfficeEditorShortcuts', () => {
  it('maps save, undo, and redo consistently', () => {
    const onRedo = vi.fn();
    const onSave = vi.fn();
    const onUndo = vi.fn();
    renderHook(() => useOfficeEditorShortcuts({ dirty: false, onRedo, onSave, onUndo }));

    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 's' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it('warns before unloading only while the document is dirty', () => {
    const preventDefault = vi.fn();
    const { rerender } = renderHook(
      ({ dirty }) =>
        useOfficeEditorShortcuts({ dirty, onRedo: vi.fn(), onSave: vi.fn(), onUndo: vi.fn() }),
      { initialProps: { dirty: false } },
    );

    window.dispatchEvent(Object.assign(new Event('beforeunload'), { preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();

    rerender({ dirty: true });
    window.dispatchEvent(Object.assign(new Event('beforeunload'), { preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
