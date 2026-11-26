import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAddTaskForm } from './useAddTaskForm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useAddTaskForm', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps the typed title and exposes an inline error when the add fails, then clears it on edit', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('boom'));
    const onDone = vi.fn();
    const { result } = renderHook(() => useAddTaskForm({ onAdd, onDone }));

    act(() => result.current.setTitle('Ship it'));
    await act(() => result.current.submit());

    expect(result.current.error).toEqual({ detail: 'boom', summary: 'goalProcess.addTask.failed' });
    expect(result.current.title).toBe('Ship it');
    expect(result.current.busy).toBe(false);
    expect(onDone).not.toHaveBeenCalled();

    act(() => result.current.setTitle('Ship it now'));
    expect(result.current.error).toBeNull();

    await act(() => result.current.submit());
    expect(result.current.error).toEqual({ detail: 'boom', summary: 'goalProcess.addTask.failed' });
    act(() => result.current.setDescription('More detail'));
    expect(result.current.error).toBeNull();
  });

  it('submits the trimmed title and finishes on success', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    const { result } = renderHook(() => useAddTaskForm({ onAdd, onDone }));

    act(() => {
      result.current.setTitle('  Ship it  ');
      result.current.setDescription('  ');
    });
    await act(() => result.current.submit());

    expect(onAdd).toHaveBeenCalledWith('Ship it', undefined);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
