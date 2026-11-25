import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResetPassword } from './useResetPassword';

const mockResetPassword = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('@/libs/better-auth/auth-client', () => ({ resetPassword: mockResetPassword }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mockToastError, success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const values = { confirmPassword: 'abc12345', newPassword: 'abc12345' };

const submit = async (token: string | null) => {
  const onSuccessRedirect = vi.fn();
  const { result } = renderHook(() =>
    useResetPassword({ email: 'user@example.com', onSuccessRedirect, token }),
  );
  result.current.form.setValues(values);
  await act(async () => {
    await result.current.form.submit();
  });
  return { onSuccessRedirect, result };
};

describe('useResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('tells the user to request a new link when the token has expired', async () => {
    mockResetPassword.mockResolvedValue({ error: { code: 'INVALID_TOKEN', status: 400 } });

    const { onSuccessRedirect, result } = await submit('expired-token');

    expect(result.current.formError).toBe('betterAuth.resetPassword.linkExpired');
    expect(onSuccessRedirect).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows a network hint next to the submit button when the request throws', async () => {
    mockResetPassword.mockRejectedValue(new Error('offline'));

    const { result } = await submit('token');

    expect(result.current.formError).toBe('betterAuth.errors.requestFailed');
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
