'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Button, Icon, Input, InputPassword, Text } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { Lock, Mail } from 'lucide-react';
import { type CSSProperties, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { AuthCard } from '@/features/AuthCard';
import AuthAgreement from '@/features/AuthShell/AuthAgreement';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';

import { EMAIL_REGEX } from '../SignIn/SignInEmailStep';
import { useSignUp } from './useSignUp';

const FIELD_STYLE: CSSProperties = { gap: 0, paddingBlock: '0 24px' };

const BetterAuthSignUpForm = () => {
  const { agreementChecked, businessElement, form, loading, setAgreementChecked } = useSignUp();

  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const email = searchParams.get('email');
    if (email) {
      form.setValue('email', email);
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
      <Form form={form} gap={0} layout="vertical">
        <Form.Field
          name="email"
          style={FIELD_STYLE}
          validate={(value: string) => {
            if (!value) return t('betterAuth.errors.emailRequired');
            if (!EMAIL_REGEX.test(value)) return t('betterAuth.errors.emailInvalid');
          }}
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
        </Form.Field>
        <Form.Field
          name="password"
          style={FIELD_STYLE}
          validate={(value: string) => {
            if (!value) return t('betterAuth.errors.passwordRequired');
            if (value.length < 8) return t('betterAuth.errors.passwordMinLength');
            if (value.length > 64) return t('betterAuth.errors.passwordMaxLength');
            if (!/[a-z]/i.test(value) || !/\d/.test(value))
              return t('betterAuth.errors.passwordFormat');
          }}
        >
          <InputPassword
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
        </Form.Field>
        <Form.Field
          deps={['password']}
          name="confirmPassword"
          style={FIELD_STYLE}
          validate={(value: string, values: { password: string }) => {
            if (!value) return t('betterAuth.errors.confirmPasswordRequired');
            if (values.password !== value) return t('betterAuth.errors.passwordMismatch');
          }}
        >
          <InputPassword
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
        </Form.Field>

        {businessElement && <div style={{ paddingBlockEnd: 24 }}>{businessElement}</div>}

        <AuthAgreement checked={agreementChecked} onChange={setAgreementChecked} />
        <Button block htmlType="submit" loading={loading} size="large" type="primary">
          {t('betterAuth.signup.submit')}
        </Button>
      </Form>
    </AuthCard>
  );
};

export default BetterAuthSignUpForm;
