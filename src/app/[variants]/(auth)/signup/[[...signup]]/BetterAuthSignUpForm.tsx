'use client';

import { Button, Icon, Text } from '@lobehub/ui';
import { Form, Input } from 'antd';
import { Lock, Mail, User } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthCard } from '../../../../../features/AuthCard';
import { useAuthServerConfigStore } from '../../_layout/AuthServerConfigProvider';
import { type SignUpFormValues } from './useSignUp';
import { useSignUp } from './useSignUp';

const BetterAuthSignUpForm = () => {
  const [form] = Form.useForm<SignUpFormValues>();
  const { loading, onSubmit, businessElement } = useSignUp();

  const { t } = useTranslation('auth');
  const searchParams = useSearchParams();
  const enablePhoneAuth = useAuthServerConfigStore((s) => s.serverConfig.enablePhoneAuth || false);

  useEffect(() => {
    const email = searchParams.get('email');
    if (email) form.setFieldsValue({ email });
  }, [searchParams, form]);

  const footer = (
    <Text>
      {t('betterAuth.signup.hasAccount')}{' '}
      <Link href={`/signin?${searchParams.toString()}`}>{t('betterAuth.signup.signinLink')}</Link>
    </Text>
  );

  const phoneSignInParams = new URLSearchParams(searchParams.toString());
  phoneSignInParams.set('mode', 'phone');

  return (
    <AuthCard
      footer={footer}
      subtitle={t('betterAuth.signup.subtitle')}
      title={t('betterAuth.signup.title')}
    >
      {enablePhoneAuth && (
        <Text style={{ display: 'block', marginBottom: 16 }}>
          <Link href={`/signin?${phoneSignInParams.toString()}`}>
            {t('betterAuth.signin.usePhone')}
          </Link>
        </Text>
      )}

      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item
          name="username"
          rules={[{ message: t('betterAuth.errors.usernameRequired'), required: true }]}
        >
          <Input
            placeholder={t('betterAuth.signup.usernamePlaceholder')}
            size="large"
            prefix={
              <Icon
                icon={User}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>
        <Form.Item
          name="email"
          rules={[
            { message: t('betterAuth.errors.emailRequired'), required: true },
            { message: t('betterAuth.errors.emailInvalid'), type: 'email' },
          ]}
        >
          <Input
            placeholder={t('betterAuth.signup.emailPlaceholder')}
            size="large"
            prefix={
              <Icon
                icon={Mail}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[
            { message: t('betterAuth.errors.passwordRequired'), required: true },
            { message: t('betterAuth.errors.passwordMinLength'), min: 8 },
            { max: 64, message: t('betterAuth.errors.passwordMaxLength') },
            {
              message: t('betterAuth.errors.passwordFormat'),
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                const hasLetter = /[a-z]/i.test(value);
                const hasNumber = /\d/.test(value);
                return hasLetter && hasNumber ? Promise.resolve() : Promise.reject();
              },
            },
          ]}
        >
          <Input.Password
            placeholder={t('betterAuth.signup.passwordPlaceholder')}
            size="large"
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>
        <Form.Item
          dependencies={['password']}
          name="confirmPassword"
          rules={[
            { message: t('betterAuth.errors.confirmPasswordRequired'), required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t('betterAuth.errors.passwordMismatch')));
              },
            }),
          ]}
        >
          <Input.Password
            placeholder={t('betterAuth.signup.confirmPasswordPlaceholder')}
            size="large"
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
          />
        </Form.Item>

        {businessElement}

        <Form.Item>
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {t('betterAuth.signup.submit')}
          </Button>
        </Form.Item>
      </Form>
    </AuthCard>
  );
};

export default BetterAuthSignUpForm;
