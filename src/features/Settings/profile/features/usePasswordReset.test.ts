import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePasswordReset } from './usePasswordReset';

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  saveToast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  requestPasswordReset: mocks.requestPasswordReset,
}));

vi.mock('@/store/utils/saveToast', () => ({ saveToast: mocks.saveToast }));

beforeEach(() => {
  mocks.requestPasswordReset.mockReset();
  mocks.saveToast.mockReset();
});

describe('usePasswordReset', () => {
  it('marks the request sent when the client resolves without an error', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });

    const { result } = renderHook(() => usePasswordReset('alex@example.com'));

    await act(async () => {
      await result.current.requestReset();
    });

    expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alex@example.com' }),
    );
    expect(result.current.sent).toBe(true);
    expect(mocks.saveToast).not.toHaveBeenCalled();
  });

  // The better-auth client resolves with `{ data, error }` rather than throwing,
  // so without an explicit error check a failed send still reports as sent.
  it('reports through the save toast and stays unsent when the client resolves with an error', async () => {
    const error = { message: 'Email provider rejected the request', status: 503 };
    mocks.requestPasswordReset.mockResolvedValue({ data: null, error });

    const { result } = renderHook(() => usePasswordReset('alex@example.com'));

    await act(async () => {
      await result.current.requestReset();
    });

    await waitFor(() => {
      expect(mocks.saveToast).toHaveBeenCalledWith(error, {
        retry: expect.any(Function),
        title: 'profile.resetPasswordError',
      });
    });
    expect(result.current.sent).toBe(false);
  });

  it('does not call the client without an email', async () => {
    const { result } = renderHook(() => usePasswordReset(undefined));

    await act(async () => {
      await result.current.requestReset();
    });

    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });
});
