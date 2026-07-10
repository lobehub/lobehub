import { Button, Icon, InputPassword, Text } from '@lobehub/ui';
import { type FormInstance, type InputRef } from 'antd';
import { Form } from 'antd';
import { Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

export interface SignInPasswordStepProps {
  email: string;
  forgotLoading: boolean;
  form: FormInstance<{ password: string }>;
  loading: boolean;
  onBackToEmail: () => void;
  onForgotPassword: () => Promise<void>;
  onSubmit: (values: { password: string }) => Promise<void>;
}

export const SignInPasswordStep = ({
  email,
  form,
  forgotLoading,
  loading,
  onBackToEmail,
  onForgotPassword,
  onSubmit,
}: SignInPasswordStepProps) => {
  const { t } = useTranslation('auth');
  const passwordInputRef = useRef<InputRef>(null);

  useEffect(() => {
    passwordInputRef.current?.focus();
  }, []);

  return (
    <AuthCard
      subtitle={email}
      title={t('betterAuth.signin.passwordStep.title')}
      footer={
        <Text align={'center'} fontSize={13} style={{ marginTop: 8 }} type={'secondary'}>
          <a
            role="button"
            style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            tabIndex={0}
            onClick={onBackToEmail}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onBackToEmail();
              }
            }}
          >
            {t('betterAuth.signin.backToEmail')}
          </a>
        </Text>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(values as { password: string })}
      >
        <Form.Item
          name="password"
          rules={[{ message: t('betterAuth.errors.passwordRequired'), required: true }]}
        >
          <InputPassword
            autoComplete="current-password"
            placeholder={t('betterAuth.signin.passwordPlaceholder')}
            prefix={<Icon icon={Lock} style={{ marginInline: 6 }} />}
            ref={passwordInputRef}
            size="large"
            style={{ padding: 6 }}
          />
        </Form.Item>
        <Button block htmlType="submit" loading={loading} size="large" type="primary">
          {t('betterAuth.signin.submit')}
        </Button>
      </Form>
      <Text align={'center'} fontSize={13} style={{ marginTop: 16 }} type={'secondary'}>
        <a
          aria-disabled={forgotLoading}
          role="button"
          tabIndex={0}
          style={{
            color: 'inherit',
            cursor: forgotLoading ? 'default' : 'pointer',
            opacity: forgotLoading ? 0.5 : 1,
            pointerEvents: forgotLoading ? 'none' : undefined,
            textDecoration: 'underline',
          }}
          onClick={onForgotPassword}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void onForgotPassword();
            }
          }}
        >
          {t('betterAuth.signin.forgotPassword')}
        </a>
      </Text>
    </AuthCard>
  );
};
