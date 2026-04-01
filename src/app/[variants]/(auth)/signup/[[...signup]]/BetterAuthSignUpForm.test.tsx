import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

const { messageError, messageSuccess, mockPostPhoneAuth, mockPush, mockUpdateUser } = vi.hoisted(
  () => ({
    messageError: vi.fn(),
    messageSuccess: vi.fn(),
    mockPostPhoneAuth: vi.fn(),
    mockPush: vi.fn(),
    mockUpdateUser: vi.fn(),
  }),
);

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key: string, options?: { seconds?: number }) => {
      if (key === 'betterAuth.signin.phonePlaceholder') return 'Enter mainland China phone number';
      if (key === 'betterAuth.signin.phoneContinue') return 'Next';
      if (key === 'betterAuth.signin.phoneCodePlaceholder') return 'Enter verification code';
      if (key === 'betterAuth.signin.phoneCodeSent') return 'Verification code sent';
      if (key === 'betterAuth.signin.resendIn') return `Resend in ${options?.seconds}s`;
      if (key === 'betterAuth.signup.signinLink') return 'Sign in now';
      if (key === 'betterAuth.signup.hasAccount') return 'Already have an account?';
      if (key === 'betterAuth.signup.submitPhoneCode') return 'Verify and sign up';
      if (key === 'betterAuth.signup.phoneProfile.subtitle')
        return 'Set your username and password';
      if (key === 'betterAuth.signup.usernamePlaceholder') return 'Enter your username';
      if (key === 'betterAuth.signup.passwordPlaceholder') return 'Enter your password';
      if (key === 'betterAuth.signup.confirmPasswordPlaceholder') return 'Confirm your password';
      if (key === 'betterAuth.signup.submit') return 'Sign Up';
      if (key === 'betterAuth.errors.usernameRequired') return 'Please enter your username';
      if (key === 'betterAuth.errors.passwordRequired') return 'Please enter your password';
      if (key === 'betterAuth.errors.confirmPasswordRequired')
        return 'Please confirm your password';
      if (key === 'betterAuth.errors.passwordMismatch') return 'Passwords do not match';
      if (key === 'betterAuth.errors.passwordMinLength')
        return 'Password must be at least 8 characters';
      if (key === 'betterAuth.errors.passwordMaxLength')
        return 'Password must not exceed 64 characters';
      if (key === 'betterAuth.errors.passwordFormat')
        return 'Password must contain both letters and numbers';
      if (key === 'profile.usernameDuplicate') return 'Username is already taken';
      if (key === 'betterAuth.signup.error') return 'Sign up failed';
      return key;
    }),
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
  useSearchParams: vi.fn(() => new URLSearchParams('callbackUrl=%2Fchat')),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    error: messageError,
    success: messageSuccess,
  },
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  updateUser: mockUpdateUser,
}));

vi.mock('../../phoneAuth', async () => {
  const actual = await vi.importActual('../../phoneAuth');

  return {
    ...actual,
    postPhoneAuth: mockPostPhoneAuth,
  };
});

vi.mock('./useSignUp', () => ({
  useSignUp: vi.fn(() => ({
    businessElement: null,
    loading: false,
    onSubmit: vi.fn(),
  })),
}));

vi.mock('../../_layout/AuthServerConfigProvider', () => ({
  useAuthServerConfigStore: vi.fn((selector) =>
    selector({
      serverConfig: {
        disableEmailPassword: false,
        enablePhoneAuth: true,
        enablePhoneSignup: true,
        phoneAuthResendInterval: 60,
      },
    }),
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ exists: false }),
      ok: true,
    })),
  );
});

describe('BetterAuthSignUpForm', () => {
  it('shows phone signup flow when phone signup is enabled', () => {
    render(<BetterAuthSignUpForm />);

    expect(screen.getByPlaceholderText('Enter mainland China phone number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in now' })).toHaveAttribute(
      'href',
      '/signin?callbackUrl=%2Fchat&mode=phone',
    );
  });

  it('shows a friendly message when phone signup username is already taken', async () => {
    const user = userEvent.setup();

    mockPostPhoneAuth
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });
    mockUpdateUser.mockResolvedValueOnce({
      error: {
        message:
          'duplicate key value violates unique constraint "users_username_unique": Key (username)=(jojo) already exists.',
      },
    });

    render(<BetterAuthSignUpForm />);

    await user.type(
      screen.getByPlaceholderText('Enter mainland China phone number'),
      '13800138000',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByPlaceholderText('Enter verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign up' }));

    await screen.findByPlaceholderText('Enter your username');

    await user.type(screen.getByPlaceholderText('Enter your username'), 'jojo');
    await user.type(screen.getByPlaceholderText('Enter your password'), 'abc12345');
    await user.type(screen.getByPlaceholderText('Confirm your password'), 'abc12345');
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));

    await waitFor(() => {
      expect(messageError).toHaveBeenCalledWith('Username is already taken');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
