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
import { PASSWORD_MIN_LENGTH } from '@/libs/better-auth/plugins/password-policy';

import { useSignUp } from './useSignUp';

const styles = createStaticStyles(({ css, cssVar }) => ({
  /**
   * Email is inherently LTR once filled, but Persian placeholders must sit on the
   * inline-start edge (right under dir=rtl). `type="email"` + UA LTR often pins the
   * empty field left; keep text + inputMode and flip direction while placeholder-shown.
   */
  emailInput: css`
    html[dir='rtl'] &:placeholder-shown {
      direction: rtl;
      text-align: start;
    }

    html[dir='rtl'] &:not(:placeholder-shown) {
      direction: ltr;
      text-align: start;
    }
  `,
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
  nameFieldLabel: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;

    width: 100%;
    max-width: 100%;
  `,
  nameInput: css`
    html[dir='rtl'] & {
      direction: rtl;
      text-align: start;
    }
  `,
  nameOptional: css`
    font-size: 12px;
    font-weight: 400;
    color: ${cssVar.colorTextTertiary};
  `,
  nameRow: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;

    /* Avoid min-content overflow clipping Persian labels in half-width columns */
    & > .ant-form-item {
      min-width: 0;
    }

    .ant-form-item-label {
      overflow: visible;
      max-width: 100%;
      text-align: start;
    }

    .ant-form-item-label > label {
      display: flex;

      width: 100%;
      max-width: 100%;
      height: auto;

      white-space: normal;
    }

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

  const nameLabel = (text: string) => (
    <span className={styles.nameFieldLabel}>
      <span>{text}</span>
      <span className={styles.nameOptional}>{t('betterAuth.signup.optional')}</span>
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
          <Form.Item
            labelWrap
            label={nameLabel(t('betterAuth.signup.firstNameLabel'))}
            name="firstName"
          >
            <Input
              autoComplete="given-name"
              className={styles.nameInput}
              placeholder={t('betterAuth.signup.firstNamePlaceholder')}
              size="large"
            />
          </Form.Item>
          <Form.Item
            labelWrap
            label={nameLabel(t('betterAuth.signup.lastNameLabel'))}
            name="lastName"
          >
            <Input
              autoComplete="family-name"
              className={styles.nameInput}
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
            className={styles.emailInput}
            inputMode="email"
            placeholder={t('betterAuth.signup.emailPlaceholder')}
            ref={emailInputRef}
            size="large"
          />
        </Form.Item>
        <Form.Item
          label={label(t('betterAuth.signup.passwordLabel'))}
          name="password"
          rules={[
            { message: t('betterAuth.errors.passwordRequired'), required: true },
            { message: t('betterAuth.errors.passwordMinLength'), min: PASSWORD_MIN_LENGTH },
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
