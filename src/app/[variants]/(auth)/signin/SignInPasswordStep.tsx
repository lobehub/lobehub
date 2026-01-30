import { Button, Icon, InputPassword, Text } from '@lobehub/ui';
import { Form } from 'antd';
import type { FormInstance, InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '../../../../features/AuthCard';

export interface SignInPasswordStepProps {
  email: string;
  form: FormInstance<{ password: string }>;
  loading: boolean;
  onBackToEmail: () => void;
  onForgotPassword: () => Promise<void>;
  onSubmit: (values: { password: string }) => Promise<void>;
}

export const SignInPasswordStep = ({
  email,
  form,
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
      footer={
        <>
          <Text fontSize={13} type={'secondary'}>
            <a
              onClick={onForgotPassword}
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('betterAuth.signin.forgotPassword')}
            </a>
          </Text>
          <Button
            icon={ChevronLeft}
            onClick={onBackToEmail}
            size={'large'}
            style={{ marginTop: 16 }}
          >
            {t('betterAuth.signin.backToEmail')}
          </Button>
        </>
      }
      subtitle={t('betterAuth.signin.passwordStep.subtitle')}
      title={'Agent teammates that grow with you'}
    >
      <Text fontSize={20}>{email}</Text>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(values as { password: string })}
        style={{ marginTop: 12 }}
      >
        <Form.Item
          name="password"
          rules={[{ message: t('betterAuth.errors.passwordRequired'), required: true }]}
          style={{ marginBottom: 0 }}
        >
          <InputPassword
            placeholder={t('betterAuth.signin.passwordPlaceholder')}
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
            ref={passwordInputRef}
            size="large"
            style={{
              padding: 6,
            }}
            suffix={
              <Button
                icon={ChevronRight}
                loading={loading}
                onClick={() => form.submit()}
                style={{ color: cssVar.colorPrimary }}
                title={t('betterAuth.signin.submit')}
                variant={'filled'}
              />
            }
          />
        </Form.Item>
      </Form>
    </AuthCard>
  );
};
