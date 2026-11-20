import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMemberBatch } from './useMemberBatch';

describe('useMemberBatch', () => {
  it('keeps the selection fixed while the batch is saving', async () => {
    let finish!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onDone = vi.fn();
    const { result } = renderHook(() => useMemberBatch(onAdd, onDone));

    act(() => result.current.toggle('u1'));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.submit();
    });
    act(() => result.current.toggle('u2'));
    expect(result.current.selected).toEqual(['u1']);

    await act(async () => {
      finish();
      await saving;
    });
    expect(onAdd).toHaveBeenCalledWith(['u1'], 'member');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open with the selection when saving fails', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() =>
      useMemberBatch(() => Promise.reject(new Error('forbidden')), onDone),
    );

    act(() => result.current.toggle('u1'));
    await act(() => result.current.submit());

    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.selected).toEqual(['u1']);
    expect(result.current.adding).toBe(false);
  });
});
