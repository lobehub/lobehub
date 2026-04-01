import { Button, Icon, Input, InputPassword, Text } from '@lobehub/ui';
import { type FormInstance, type InputRef } from 'antd';
import { Form } from 'antd';
import { KeyRound, Lock, Smartphone } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '../../../../features/AuthCard';

interface PhoneFormValues {
  code?: string;
  password?: string;
  phone?: string;
}

export interface SignInPhoneStepProps {
  action?: ReactNode;
  cooldown: number;
  footer?: ReactNode;
  form: FormInstance<PhoneFormValues>;
  loading: boolean;
  mode: 'input' | 'password' | 'verify';
  modeSwitch?: ReactNode;
  onBackToEmail?: () => void;
  onSendCode: (values: { phone: string }) => Promise<void>;
  onSubmitCode: (values: { code: string }) => Promise<void>;
  onSubmitPassword?: (values: { password: string }) => Promise<void>;
  phone?: string;
  showBackLink?: boolean;
  submitCodeText?: string;
  submitInputText?: string;
  submitPasswordText?: string;
  title?: ReactNode;
}

export const SignInPhoneStep = ({
  action,
  cooldown,
  footer,
  form,
  loading,
  mode,
  modeSwitch,
  onBackToEmail,
  onSendCode,
  onSubmitCode,
  onSubmitPassword,
  phone,
  showBackLink = true,
  submitCodeText,
  submitInputText,
  submitPasswordText,
  title = 'Agent teammates that grow with you',
}: SignInPhoneStepProps) => {
  const { t } = useTranslation('auth');
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const fallbackFooter =
    showBackLink && onBackToEmail ? (
      <Text fontSize={13} type={'secondary'}>
        <a
          style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
          onClick={onBackToEmail}
        >
          {t('betterAuth.signin.backToEmail')}
        </a>
      </Text>
    ) : null;

  return (
    <AuthCard
      footer={footer ?? fallbackFooter}
      title={title}
      subtitle={
        mode === 'input'
          ? t('betterAuth.signin.phoneStep.subtitle')
          : mode === 'verify'
            ? t('betterAuth.signin.phoneVerify.subtitle')
            : t('betterAuth.signin.phonePassword.subtitle')
      }
    >
      {modeSwitch && <div style={{ marginBottom: 24 }}>{modeSwitch}</div>}
      {(mode === 'verify' || mode === 'password') && phone && <Text fontSize={20}>{phone}</Text>}

      <Form
        form={form}
        layout="vertical"
        style={mode === 'verify' || mode === 'password' ? { marginTop: 12 } : undefined}
        onFinish={async (values) => {
          if (mode === 'input') {
            await onSendCode(values as { phone: string });
            return;
          }

          if (mode === 'verify') {
            await onSubmitCode(values as { code: string });
            return;
          }

          if (onSubmitPassword) {
            await onSubmitPassword(values as { password: string });
          }
        }}
      >
        <Form.Item
          name={mode === 'input' ? 'phone' : mode === 'verify' ? 'code' : 'password'}
          rules={
            mode === 'input'
              ? [{ message: t('betterAuth.errors.phoneRequired'), required: true }]
              : mode === 'verify'
                ? [{ message: t('betterAuth.errors.otpRequired'), required: true }]
                : [{ message: t('betterAuth.errors.passwordRequired'), required: true }]
          }
        >
          {mode === 'password' ? (
            <InputPassword
              placeholder={t('betterAuth.signin.phonePasswordPlaceholder')}
              ref={inputRef}
              size="large"
              prefix={
                <Icon
                  icon={Lock}
                  style={{
                    marginInline: 6,
                  }}
                />
              }
              style={{
                padding: 6,
              }}
            />
          ) : (
            <Input
              ref={inputRef}
              size="large"
              placeholder={
                mode === 'input'
                  ? t('betterAuth.signin.phonePlaceholder')
                  : t('betterAuth.signin.phoneCodePlaceholder')
              }
              prefix={
                <Icon
                  icon={mode === 'input' ? Smartphone : KeyRound}
                  style={{
                    marginInline: 6,
                  }}
                />
              }
              style={{
                padding: 6,
              }}
            />
          )}
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {mode === 'input'
              ? (submitInputText ?? t('betterAuth.signin.sendCode'))
              : mode === 'verify'
                ? (submitCodeText ?? t('betterAuth.signin.submitPhoneCode'))
                : (submitPasswordText ?? t('betterAuth.signin.submitPhonePassword'))}
          </Button>
        </Form.Item>
      </Form>

      {mode === 'verify' && (
        <Text fontSize={13} style={{ marginTop: 12 }} type={'secondary'}>
          {cooldown > 0
            ? t('betterAuth.signin.resendIn', { seconds: cooldown })
            : t('betterAuth.signin.phoneCodeSent')}
        </Text>
      )}

      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </AuthCard>
  );
};
