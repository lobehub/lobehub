import { Alert, Input, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type FormInstance, type InputRef } from 'antd';
import { Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthSocialButtons from '@/features/Auth/AuthSocialButtons';
import AuthCard from '@/features/AuthCard';
import { AuthAgreement, useAuthAgreement } from '@/features/AuthShell';

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
  inlineLink: css`
    cursor: pointer;
    color: ${cssVar.colorPrimary};
    text-decoration: underline;
  `,
}));

export const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
export const USERNAME_REGEX = /^\w+$/;

export interface SignInEmailStepProps {
  disableEmailPassword?: boolean;
  form: FormInstance<{ email: string }>;
  isSocialOnly: boolean;
  loading: boolean;
  oAuthSSOProviders: string[];
  onCheckUser: (values: { email: string }) => Promise<void>;
  onGoToPhone: () => void;
  onGoToSignup: () => void;
  onResetEmail: () => void;
  onSetPassword: () => void;
  onSocialSignIn: (provider: string) => void;
  serverConfigInit: boolean;
  socialLoading: string | null;
}

export const SignInEmailStep = ({
  disableEmailPassword,
  form,
  isSocialOnly,
  loading,
  oAuthSSOProviders,
  serverConfigInit,
  socialLoading,
  onCheckUser,
  onGoToPhone,
  onGoToSignup,
  onResetEmail,
  onSetPassword,
  onSocialSignIn,
}: SignInEmailStepProps) => {
  const { t } = useTranslation('auth');
  const { agreementChecked, continueWithAgreement, setAgreementChecked } = useAuthAgreement();
  const emailInputRef = useRef<InputRef>(null);

  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  // Config is injected synchronously via window.__SERVER_CONFIG__, so the email
  // form is the primary path unless the account is social-only.
  const showEmailForm = !disableEmailPassword && !isSocialOnly;
  const showAuthMethods = serverConfigInit;

  return (
    <AuthCard title={t('betterAuth.signin.emailStep.title')}>
      {showAuthMethods && (
        <AuthSocialButtons
          oAuthSSOProviders={oAuthSSOProviders}
          showDivider={showEmailForm}
          socialLoading={socialLoading}
          onPhoneClick={onGoToPhone}
          onSocialSignIn={(provider) =>
            continueWithAgreement(() => {
              onSocialSignIn(provider);
            })
          }
        />
      )}
      {serverConfigInit && disableEmailPassword && oAuthSSOProviders.length === 0 && (
        <Alert showIcon description={t('betterAuth.signin.ssoOnlyNoProviders')} type="warning" />
      )}
      {showEmailForm && (
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) =>
            continueWithAgreement(() => {
              void onCheckUser(values as { email: string });
            })
          }
        >
          <Form.Item
            label={<span className={styles.fieldLabel}>{t('betterAuth.signin.emailLabel')}</span>}
            name="email"
            rules={[
              { message: t('betterAuth.errors.emailRequired'), required: true },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  const trimmedValue = (value as string).trim();
                  if (EMAIL_REGEX.test(trimmedValue) || USERNAME_REGEX.test(trimmedValue)) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('betterAuth.errors.emailInvalid')));
                },
              },
            ]}
          >
            <Input
              autoComplete="username"
              inputMode="email"
              placeholder={t('betterAuth.signin.emailPlaceholder')}
              ref={emailInputRef}
              size="large"
            />
          </Form.Item>
          <AuthAgreement checked={agreementChecked} onChange={setAgreementChecked} />
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {t('betterAuth.signin.nextStep')}
          </Button>
        </Form>
      )}
      {isSocialOnly && (
        <Alert
          showIcon
          style={{ marginTop: 4 }}
          type="info"
          description={
            <>
              {t('betterAuth.signin.socialOnlyHint')}{' '}
              <a
                className={styles.inlineLink}
                role="button"
                tabIndex={0}
                onClick={onSetPassword}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSetPassword();
                  }
                }}
              >
                {t('betterAuth.signin.setPassword')}
              </a>
            </>
          }
        />
      )}
      {isSocialOnly && (
        <Text align={'center'} fontSize={13} type={'secondary'}>
          <a
            className={styles.inlineLink}
            role="button"
            tabIndex={0}
            onClick={onResetEmail}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onResetEmail();
              }
            }}
          >
            {t('betterAuth.signin.emailSent.changeEmail')}
          </a>
        </Text>
      )}
      {!showEmailForm && <AuthAgreement />}
      {showEmailForm && (
        <Text align={'center'} fontSize={13} style={{ marginTop: 4 }} type={'secondary'}>
          {t('betterAuth.signin.noAccount')}{' '}
          <a
            className={styles.footerLink}
            role="button"
            tabIndex={0}
            onClick={onGoToSignup}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onGoToSignup();
              }
            }}
          >
            {t('betterAuth.signin.signupLink')}
          </a>
        </Text>
      )}
    </AuthCard>
  );
};
