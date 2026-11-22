import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANGE_EMAIL_IN_USE_CODE } from '@/libs/better-auth/constants';

import EmailRow from './EmailRow';

const mocks = vi.hoisted(() => ({
  changeEmail: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: false,
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { email?: string }) =>
      options?.email ? `${key}:${options.email}` : key,
  }),
}));

vi.mock('@/libs/better-auth/auth-client', () => ({ changeEmail: mocks.changeEmail }));

vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.example.com' }));

vi.mock('@/services/electron/system', () => ({ electronSystemService: {} }));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { email: 'old@example.com' } }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    email: (state: { user?: { email?: string } }) => state.user?.email,
  },
}));

vi.mock('./ProfileRow', () => ({
  default: ({ action, children }: { action?: ReactNode; children?: ReactNode }) => (
    <div>
      {children}
      {action}
    </div>
  ),
}));

const submitEmail = async (value: string) => {
  const user = userEvent.setup();
  render(<EmailRow />);
  await user.click(screen.getByText('profile.updateEmail'));
  await user.type(screen.getByPlaceholderText('profile.emailPlaceholder'), value);
  await user.click(screen.getByText('profile.save'));
  return user;
};

describe('EmailRow', () => {
  beforeEach(() => {
    mocks.changeEmail.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows next steps under the input, not a toast, when the email belongs to another account', async () => {
    mocks.changeEmail.mockResolvedValue({
      error: { code: CHANGE_EMAIL_IN_USE_CODE, message: 'in use' },
    });

    const user = await submitEmail('taken@example.com');

    expect(await screen.findByText('profile.emailInUseHint:taken@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('profile.emailPlaceholder')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(mocks.toastError).not.toHaveBeenCalled();

    // Editing the address clears the stale error
    await user.type(screen.getByPlaceholderText('profile.emailPlaceholder'), 'x');
    expect(screen.queryByText('profile.emailInUseHint:taken@example.com')).not.toBeInTheDocument();
  });

  it('shows an actionable inline error when the request fails', async () => {
    mocks.changeEmail.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await submitEmail('new@example.com');

    expect(await screen.findByText('profile.emailChangeFailed')).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows friendly copy instead of the raw server message for other errors', async () => {
    mocks.changeEmail.mockResolvedValue({
      error: { message: "Verification email isn't enabled", status: 400 },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await submitEmail('new@example.com');

    expect(await screen.findByText('profile.emailChangeFailed')).toBeInTheDocument();
    expect(screen.queryByText("Verification email isn't enabled")).not.toBeInTheDocument();
  });

  it('tells the user to wait when change-email is rate limited', async () => {
    mocks.changeEmail.mockResolvedValue({
      error: { code: 'TOO_MANY_CHANGE_EMAIL_REQUESTS', message: 'Too many', status: 429 },
    });

    await submitEmail('new@example.com');

    expect(await screen.findByText('profile.emailChangeTooMany')).toBeInTheDocument();
  });

  it('rejects the current email inline without calling the API', async () => {
    await submitEmail('OLD@example.com');

    expect(await screen.findByText('profile.emailSameAsCurrent')).toBeInTheDocument();
    expect(mocks.changeEmail).not.toHaveBeenCalled();
  });

  it('shows the invalid-format error inline without calling the API', async () => {
    await submitEmail('not-an-email');

    await waitFor(() => expect(screen.getByText('profile.emailInvalid')).toBeInTheDocument());
    expect(mocks.changeEmail).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
