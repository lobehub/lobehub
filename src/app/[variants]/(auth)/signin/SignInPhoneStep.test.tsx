import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SignInPhoneStep } from './SignInPhoneStep';

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
  it('renders phone input mode by default', () => {
    renderComponent();

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('submits phone number when continue button is clicked', async () => {
    const user = userEvent.setup();
    const onSendCode = vi.fn();
    renderComponent({ onSendCode });

    await user.type(screen.getByRole('textbox'), '13800138000');
    await user.click(screen.getByRole('button'));

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

    await user.type(screen.getByRole('textbox'), '123456');
    await user.click(screen.getByRole('button'));

    expect(onSubmitCode).toHaveBeenCalledWith({ code: '123456' });
  });
});
