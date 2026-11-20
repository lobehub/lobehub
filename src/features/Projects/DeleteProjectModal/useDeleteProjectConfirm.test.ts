import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDeleteProjectConfirm } from './useDeleteProjectConfirm';

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.toastError } }));

const setup = (onConfirm = vi.fn().mockResolvedValue(undefined)) => {
  const close = vi.fn();
  const hook = renderHook(() =>
    useDeleteProjectConfirm({ close, onConfirm, projectName: 'LobeHub Cloud' }),
  );
  return { close, hook, onConfirm };
};

describe('useDeleteProjectConfirm', () => {
  beforeEach(() => {
    mocks.toastError.mockReset();
  });

  it('only allows the delete once the exact project name is typed', async () => {
    const { hook, onConfirm } = setup();
    expect(hook.result.current.canContinue).toBe(false);

    act(() => hook.result.current.setNameInput('LobeHub'));
    expect(hook.result.current.canContinue).toBe(false);
    act(() => hook.result.current.setNameInput('lobehub cloud'));
    expect(hook.result.current.canContinue).toBe(false);

    await act(() => hook.result.current.submit());
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => hook.result.current.setNameInput('  LobeHub Cloud '));
    expect(hook.result.current.canContinue).toBe(true);
  });

  it('deletes and closes once the name matches', async () => {
    const { close, hook, onConfirm } = setup();

    act(() => hook.result.current.setNameInput('LobeHub Cloud'));
    await act(() => hook.result.current.submit());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('stays open and reports the error when the delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { close, hook } = setup(vi.fn().mockRejectedValue(new Error('boom')));

    act(() => hook.result.current.setNameInput('LobeHub Cloud'));
    await act(() => hook.result.current.submit());

    expect(mocks.toastError).toHaveBeenCalledWith('list.deleteError');
    expect(close).not.toHaveBeenCalled();
    expect(hook.result.current.loading).toBe(false);
  });
});
