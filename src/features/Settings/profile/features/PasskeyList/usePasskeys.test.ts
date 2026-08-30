import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR } from '@/libs/better-auth/constants';

import { usePasskeys } from './usePasskeys';

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  updatePasskey: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  refetch: vi.fn(),
  useListPasskeys: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  passkey: {
    addPasskey: mocks.addPasskey,
    deletePasskey: mocks.deletePasskey,
    updatePasskey: mocks.updatePasskey,
  },
  useListPasskeys: mocks.useListPasskeys,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useListPasskeys.mockReturnValue({
    data: [],
    isPending: false,
    refetch: mocks.refetch,
  });
});

describe('usePasskeys', () => {
  it('exposes the credentials returned by the plugin query', () => {
    mocks.useListPasskeys.mockReturnValue({
      data: [{ id: 'a', name: 'MacBook' }],
      isPending: false,
      refetch: mocks.refetch,
    });

    const { result } = renderHook(() => usePasskeys());

    expect(result.current.passkeys).toEqual([{ id: 'a', name: 'MacBook' }]);
    expect(result.current.isLoading).toBe(false);
  });

  it('refreshes the list after a passkey is registered', async () => {
    mocks.addPasskey.mockResolvedValue({ data: { id: 'a' }, error: null });

    const { result } = renderHook(() => usePasskeys());
    await act(async () => {
      await result.current.addPasskey();
    });

    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalled();
  });

  // The better-auth client resolves with `{ data, error }` instead of throwing,
  // so without an explicit check a failed registration would look successful.
  it('reports an error when the client resolves with one', async () => {
    mocks.addPasskey.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => usePasskeys());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.addPasskey();
    });

    expect(returned).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith('boom');
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  // Dismissing the platform prompt raises NotAllowedError. That is the user
  // changing their mind, so it must not surface as a failure.
  it('stays silent when the user cancels the browser prompt', async () => {
    const cancelled = new Error('cancelled');
    cancelled.name = 'NotAllowedError';
    mocks.addPasskey.mockRejectedValue(cancelled);

    const { result } = renderHook(() => usePasskeys());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.addPasskey();
    });

    expect(returned).toBe(false);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('still reports unexpected registration failures', async () => {
    mocks.addPasskey.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePasskeys());
    await act(async () => {
      await result.current.addPasskey();
    });

    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('refreshes the list after a passkey is removed', async () => {
    mocks.deletePasskey.mockResolvedValue({ data: { status: true }, error: null });

    const { result } = renderHook(() => usePasskeys());
    await act(async () => {
      await result.current.deletePasskey('a');
    });

    expect(mocks.deletePasskey).toHaveBeenCalledWith({ id: 'a' });
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('reports a failed removal and leaves the list untouched', async () => {
    mocks.deletePasskey.mockResolvedValue({ data: null, error: { message: 'nope' } });

    const { result } = renderHook(() => usePasskeys());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.deletePasskey('a');
    });

    expect(returned).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith('nope');
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it('localizes the server guard when a concurrent deletion would remove the last passkey', async () => {
    mocks.deletePasskey.mockResolvedValue({
      data: null,
      error: {
        code: PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR,
        message: PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR,
      },
    });

    const { result } = renderHook(() => usePasskeys());
    await act(async () => {
      await result.current.deletePasskey('a');
    });

    expect(mocks.toastError).toHaveBeenCalledWith('profile.passkey.delete.forbidden');
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  // Authenticators often register without a label, so renaming is the only way
  // to tell several credentials apart.
  it('renames a passkey and refreshes the list', async () => {
    mocks.updatePasskey.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => usePasskeys());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renamePasskey('key-1', 'MacBook Touch ID');
    });

    expect(ok).toBe(true);
    expect(mocks.updatePasskey).toHaveBeenCalledWith({
      id: 'key-1',
      name: 'MacBook Touch ID',
    });
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('reports a rename failure without refreshing', async () => {
    mocks.updatePasskey.mockResolvedValue({ error: { message: 'nope' } });

    const { result } = renderHook(() => usePasskeys());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renamePasskey('key-1', 'x');
    });

    expect(ok).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith('nope');
  });
});
