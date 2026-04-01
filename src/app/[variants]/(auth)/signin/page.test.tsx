import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SignInPage from './page';

const useSignInMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: () => <div data-testid="signin-loading" />,
}));

vi.mock('./useSignIn', () => ({
  useSignIn: () => useSignInMock(),
}));

vi.mock('./SignInPhoneStep', () => ({
  SignInPhoneStep: ({ modeSwitch }: { modeSwitch?: any }) => (
    <div data-testid="phone-step">{modeSwitch}</div>
  ),
}));

vi.mock('./SignInEmailStep', () => ({
  SignInEmailStep: ({ modeSwitch }: { modeSwitch?: any }) => (
    <div data-testid="email-step">{modeSwitch}</div>
  ),
}));

vi.mock('./SignInPasswordStep', () => ({
  SignInPasswordStep: () => <div data-testid="password-step" />,
}));

const createState = (overrides: Record<string, unknown> = {}) => ({
  disableEmailPassword: false,
  enablePhoneAuth: true,
  email: '',
  form: {} as any,
  handleBackToEmail: vi.fn(),
  handleCheckUser: vi.fn(),
  handleForgotPassword: vi.fn(),
  handlePhonePasswordSignIn: vi.fn(),
  handleResetPhoneInput: vi.fn(),
  handleSignIn: vi.fn(),
  handleSocialSignIn: vi.fn(),
  handleSendPhoneCode: vi.fn(),
  handleUsePhoneCode: vi.fn(),
  handleUsePhonePassword: vi.fn(),
  handleVerifyPhoneCode: vi.fn(),
  isSocialOnly: false,
  lastAuthProvider: null,
  loading: false,
  oAuthSSOProviders: [],
  phone: '',
  phoneCooldown: 0,
  phoneForm: {} as any,
  phoneHasPassword: false,
  phoneMode: 'input',
  serverConfigInit: true,
  socialLoading: null,
  step: 'phone',
  ...overrides,
});

describe('SignInPage mode switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows email switch in phone mode when email login is enabled', () => {
    const handleBackToEmail = vi.fn();

    useSignInMock.mockReturnValue(
      createState({
        disableEmailPassword: false,
        handleBackToEmail,
        step: 'phone',
      }),
    );

    render(<SignInPage />);

    expect(screen.getByTestId('phone-step')).toBeInTheDocument();

    fireEvent.click(screen.getByText('betterAuth.signin.useEmailOrUsername'));
    expect(handleBackToEmail).toHaveBeenCalledTimes(1);
  });

  it('shows use-phone link in email mode when phone login is enabled', () => {
    const handleResetPhoneInput = vi.fn();

    useSignInMock.mockReturnValue(
      createState({
        disableEmailPassword: false,
        handleResetPhoneInput,
        step: 'email',
      }),
    );

    render(<SignInPage />);

    expect(screen.getByTestId('email-step')).toBeInTheDocument();

    fireEvent.click(screen.getByText('betterAuth.signin.usePhone'));
    expect(handleResetPhoneInput).toHaveBeenCalledTimes(1);
  });

  it('hides mode switch when email login is disabled', () => {
    useSignInMock.mockReturnValue(
      createState({
        disableEmailPassword: true,
        step: 'phone',
      }),
    );

    render(<SignInPage />);

    expect(screen.getByTestId('phone-step')).toBeInTheDocument();
    expect(screen.queryByText('betterAuth.signin.useEmailOrUsername')).not.toBeInTheDocument();
    expect(screen.queryByText('betterAuth.signin.usePhone')).not.toBeInTheDocument();
  });
});
