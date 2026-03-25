import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import { describe, expect, it, vi } from 'vitest';

import { SignInEmailStep } from './SignInEmailStep';

vi.mock('react-i18next', () => ({
  Trans: ({ children }: any) => children,
  useTranslation: vi.fn(() => ({
    t: vi.fn((key: string) => {
      if (key === 'betterAuth.signin.emailPlaceholder') return 'Enter your email or username';
      if (key === 'betterAuth.signin.phonePlaceholder') return 'Enter mainland China phone number';
      return key;
    }),
  })),
}));

const renderComponent = () => {
  const TestComponent = () => {
    const [emailForm] = Form.useForm<{ email: string }>();
    const [phoneForm] = Form.useForm<{ phone: string }>();

    return (
      <SignInEmailStep
        disableEmailPassword={false}
        enablePhoneAuth={true}
        form={emailForm}
        isSocialOnly={false}
        loading={false}
        oAuthSSOProviders={[]}
        phoneForm={phoneForm}
        serverConfigInit={true}
        socialLoading={null}
        onCheckUser={vi.fn()}
        onSendPhoneCode={vi.fn()}
        onSetPassword={vi.fn()}
        onSocialSignIn={vi.fn()}
      />
    );
  };

  return render(<TestComponent />);
};

describe('SignInEmailStep phone entry', () => {
  it('renders phone input alongside email input when phone auth is enabled', () => {
    renderComponent();

    expect(screen.getByPlaceholderText('Enter your email or username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter mainland China phone number')).toBeInTheDocument();
  });
});
