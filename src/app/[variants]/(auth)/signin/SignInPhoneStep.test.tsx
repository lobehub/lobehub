import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SignInPhoneStep } from './SignInPhoneStep';

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key: string, options?: any) => {
      if (key === 'betterAuth.signin.phonePlaceholder') return 'Enter mainland China phone number';
      if (key === 'betterAuth.signin.phoneCodePlaceholder') return 'Enter verification code';
      if (key === 'betterAuth.signin.sendCode') return 'Send code';
      if (key === 'betterAuth.signin.submitPhoneCode') return 'Verify and sign in';
      if (key === 'betterAuth.signin.phoneCodeSent') return 'Verification code sent';
      if (key === 'betterAuth.signin.resendIn') return `Resend in ${options.seconds}s`;
      return key;
    }),
  })),
}));

const renderComponent = (props?: Partial<ComponentProps<typeof SignInPhoneStep>>) => {
  const TestComponent = () => {
    const [form] = Form.useForm<{ code?: string; phone?: string }>();

    return (
      <SignInPhoneStep
        cooldown={0}
        form={form}
        loading={false}
        mode={'input'}
        onBackToEmail={vi.fn()}
        onSendCode={vi.fn()}
        onSubmitCode={vi.fn()}
        {...props}
      />
    );
  };

  return render(<TestComponent />);
};

describe('SignInPhoneStep', () => {
  it('renders phone input mode with a separate send-code button', () => {
    renderComponent();

    expect(screen.getByPlaceholderText('Enter mainland China phone number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
  });

  it('submits phone number when send-code button is clicked', async () => {
    const user = userEvent.setup();
    const onSendCode = vi.fn();
    renderComponent({ onSendCode });

    await user.type(
      screen.getByPlaceholderText('Enter mainland China phone number'),
      '13800138000',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(onSendCode).toHaveBeenCalledWith({ phone: '13800138000' });
  });

  it('renders verification mode with code submit action', async () => {
    const user = userEvent.setup();
    const onSubmitCode = vi.fn();

    renderComponent({
      mode: 'verify',
      onSubmitCode,
      phone: '+8613800138000',
    });

    await user.type(screen.getByPlaceholderText('Enter verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(onSubmitCode).toHaveBeenCalledWith({ code: '123456' });
  });
});
