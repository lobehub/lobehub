'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Button, Icon, Text } from '@lobehub/ui';
import { Form, Input, type InputRef } from 'antd';
import { Lock, Mail } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { AuthCard } from '@/features/AuthCard';
import { AuthAgreement } from '@/features/AuthShell';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';

import { useSignUp } from './useSignUp';

const BetterAuthSignUpForm = () => {
  const { form, loading, onSubmit, businessElement } = useSignUp();

  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const emailInputRef = useRef<InputRef>(null);
  const passwordInputRef = useRef<InputRef>(null);

  useEffect(() => {
    const email = searchParams.get('email');
    if (email) {
      form.setFieldsValue({ email });
      passwordInputRef.current?.focus();
    } else {
      emailInputRef.current?.focus();
    }
  }, [searchParams, form]);

  const footer = (
    <Text>
      {t('betterAuth.signup.hasAccount')}{' '}
      <Link
        to={`/signin?${searchParams.toString()}`}
        onClick={(event) => {
          event.preventDefault();
          void trackLoginOrSignupClicked({ spm: 'signup.go_to_signin.click' }).finally(() => {
            navigate(`/signin?${searchParams.toString()}`);
          });
        }}
      >
        {t('betterAuth.signup.signinLink')}
      </Link>
    </Text>
  );

  return (
    <AuthCard footer={footer} title={t('betterAuth.signup.cardTitle', { appName: BRANDING_NAME })}>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item
          name="email"
          rules={[
            { message: t('betterAuth.errors.emailRequired'), required: true },
            { message: t('betterAuth.errors.emailInvalid'), type: 'email' },
          ]}
        >
          <Input
            autoComplete="email"
            inputMode="email"
            placeholder={t('betterAuth.signup.emailPlaceholder')}
            ref={emailInputRef}
            size="large"
            type="email"
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
            autoComplete="new-password"
            placeholder={t('betterAuth.signup.passwordPlaceholder')}
            ref={passwordInputRef}
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
            autoComplete="new-password"
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
      <AuthAgreement />
    </AuthCard>
  );
};

export default BetterAuthSignUpForm;
