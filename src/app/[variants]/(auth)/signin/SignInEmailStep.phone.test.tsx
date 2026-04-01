import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import { describe, expect, it, vi } from 'vitest';

import { SignInEmailStep } from './SignInEmailStep';

vi.mock('react-i18next', () => ({
  Trans: ({ children }: any) => children,
  useTranslation: vi.fn(() => ({
    t: vi.fn((key: string) => {
      if (key === 'betterAuth.signin.emailPlaceholder') return 'Enter your email or username';
      if (key === 'betterAuth.signin.orContinueWith') return 'OR';
      return key;
    }),
  })),
}));

const renderComponent = () => {
  const TestComponent = () => {
    const [emailForm] = Form.useForm<{ email: string }>();

    return (
      <SignInEmailStep
        disableEmailPassword={false}
        form={emailForm}
        isSocialOnly={false}
        loading={false}
        modeSwitch={<div>Email / Username | Phone Number</div>}
        oAuthSSOProviders={[]}
        serverConfigInit={true}
        socialLoading={null}
        onCheckUser={vi.fn()}
        onSetPassword={vi.fn()}
        onSocialSignIn={vi.fn()}
      />
    );
  };

  return render(<TestComponent />);
};

describe('SignInEmailStep phone entry', () => {
  it('renders email input and mode switch without inline phone input', () => {
    renderComponent();

    expect(screen.getByText('Email / Username | Phone Number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your email or username')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Enter mainland China phone number'),
    ).not.toBeInTheDocument();
  });
});
