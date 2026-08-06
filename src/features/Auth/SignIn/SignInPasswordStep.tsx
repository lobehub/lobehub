import { InputPassword, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type FormInstance, type InputRef } from 'antd';
import { Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldLabel: css`
    margin-block-end: 6px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  link: css`
    cursor: pointer;
    font-weight: 600;
    color: ${cssVar.colorPrimary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimaryHover};
    }
  `,
  secondaryLink: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

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
        <Text align={'center'} fontSize={13} type={'secondary'}>
          <a
            className={styles.secondaryLink}
            role="button"
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
        requiredMark={false}
        onFinish={(values) => onSubmit(values as { password: string })}
      >
        <Form.Item
          label={<span className={styles.fieldLabel}>{t('betterAuth.signin.passwordLabel')}</span>}
          name="password"
          rules={[{ message: t('betterAuth.errors.passwordRequired'), required: true }]}
        >
          <InputPassword
            autoComplete="current-password"
            placeholder={t('betterAuth.signin.passwordPlaceholder')}
            ref={passwordInputRef}
            size="large"
          />
        </Form.Item>
        <Button block htmlType="submit" loading={loading} size="large" type="primary">
          {t('betterAuth.signin.submit')}
        </Button>
      </Form>
      <Text align={'center'} fontSize={13} style={{ marginTop: 4 }} type={'secondary'}>
        <a
          aria-disabled={forgotLoading}
          className={styles.link}
          role="button"
          tabIndex={0}
          style={{
            cursor: forgotLoading ? 'default' : 'pointer',
            opacity: forgotLoading ? 0.5 : 1,
            pointerEvents: forgotLoading ? 'none' : undefined,
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
