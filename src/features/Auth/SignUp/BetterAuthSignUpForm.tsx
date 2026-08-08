'use client';

import { Input, InputPassword, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Form, type InputRef } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import AuthSocialButtons from '@/features/Auth/AuthSocialButtons';
import { AuthCard } from '@/features/AuthCard';
import { AuthAgreement, useAuthAgreement, useAuthServerConfigStore } from '@/features/AuthShell';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';

import { useSignUp } from './useSignUp';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldLabel: css`
    margin-block-end: 6px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  footerLink: css`
    cursor: pointer;
    font-weight: 600;
    color: ${cssVar.colorPrimary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimaryHover};
    }
  `,
  nameRow: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;

    @media (width <= 420px) {
      grid-template-columns: 1fr;
    }
  `,
  optional: css`
    margin-inline-start: 6px;
    font-size: 12px;
    font-weight: 400;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const BetterAuthSignUpForm = () => {
  const { form, loading, onSubmit, businessElement, socialLoading, onSocialSignIn } = useSignUp();

  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { agreementChecked, continueWithAgreement, setAgreementChecked } = useAuthAgreement();
  const oAuthSSOProviders = useAuthServerConfigStore((s) => s.serverConfig.oAuthSSOProviders) || [];

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
    <Text align="center" fontSize={13} type="secondary">
      {t('betterAuth.signup.hasAccount')}{' '}
      <Link
        className={styles.footerLink}
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

  const label = (text: string, optional?: boolean) => (
    <span className={styles.fieldLabel}>
      {text}
      {optional ? <span className={styles.optional}>{t('betterAuth.signup.optional')}</span> : null}
    </span>
  );

  return (
    <AuthCard footer={footer} title={t('betterAuth.signup.title')}>
      <AuthSocialButtons
        phoneDisabled
        showDivider
        oAuthSSOProviders={oAuthSSOProviders}
        phoneDisabledHintKey="betterAuth.signup.phoneDisabledHint"
        phoneLabelKey="betterAuth.signup.phoneLink"
        socialLoading={socialLoading}
        onPhoneClick={() => {}}
        onSocialSignIn={(provider) =>
          continueWithAgreement(() => {
            void onSocialSignIn(provider);
          })
        }
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) =>
          continueWithAgreement(() => {
            void onSubmit(values);
          })
        }
      >
        <div className={styles.nameRow}>
          <Form.Item label={label(t('betterAuth.signup.firstNameLabel'), true)} name="firstName">
            <Input
              autoComplete="given-name"
              placeholder={t('betterAuth.signup.firstNamePlaceholder')}
              size="large"
            />
          </Form.Item>
          <Form.Item label={label(t('betterAuth.signup.lastNameLabel'), true)} name="lastName">
            <Input
              autoComplete="family-name"
              placeholder={t('betterAuth.signup.lastNamePlaceholder')}
              size="large"
            />
          </Form.Item>
        </div>
        <Form.Item
          label={label(t('betterAuth.signup.emailLabel'))}
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
          />
        </Form.Item>
        <Form.Item
          label={label(t('betterAuth.signup.passwordLabel'))}
          name="password"
          rules={[
            { message: t('betterAuth.errors.passwordRequired'), required: true },
            { message: t('betterAuth.errors.passwordMinLength'), min: 10 },
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
          <InputPassword
            autoComplete="new-password"
            placeholder={t('betterAuth.signup.passwordPlaceholder')}
            ref={passwordInputRef}
            size="large"
          />
        </Form.Item>
        <Form.Item
          dependencies={['password']}
          label={label(t('betterAuth.signup.confirmPasswordLabel'))}
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
          <InputPassword
            autoComplete="new-password"
            placeholder={t('betterAuth.signup.confirmPasswordPlaceholder')}
            size="large"
          />
        </Form.Item>

        {businessElement}

        <AuthAgreement checked={agreementChecked} onChange={setAgreementChecked} />
        <Form.Item style={{ marginBottom: 0 }}>
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {t('betterAuth.signup.submit')}
          </Button>
        </Form.Item>
      </Form>
    </AuthCard>
  );
};

export default BetterAuthSignUpForm;
