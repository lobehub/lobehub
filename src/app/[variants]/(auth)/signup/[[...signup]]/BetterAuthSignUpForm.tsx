'use client';

import { Button } from '@lobehub/ui';
import { LobeHub } from '@lobehub/ui/brand';
import { Form, Input } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronRight, Lock, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { message } from '@/components/AntdStaticMethods';
import { authEnv } from '@/envs/auth';
import { signUp } from '@/libs/better-auth/auth-client';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 2.5rem;
    padding-inline: 2rem;
  `,
  container: css`
    width: 360px;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;
  `,
  footer: css`
    padding: 1rem;
    border-block-start: 1px solid ${token.colorBorder};

    font-size: 14px;
    color: ${token.colorTextDescription};
    text-align: center;

    background: ${token.colorBgElevated};
  `,
  subtitle: css`
    margin-block-start: 0.5rem;
    font-size: 14px;
    color: ${token.colorTextSecondary};
    text-align: center;
  `,
  title: css`
    margin-block-start: 1rem;

    font-size: 24px;
    font-weight: 600;
    color: ${token.colorTextHeading};
    text-align: center;
  `,
}));

interface SignUpFormValues {
  confirmPassword: string;
  email: string;
  password: string;
}

export default function BetterAuthSignUpForm() {
  const { styles } = useStyles();
  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // Pre-fill email from query params (from signin page redirect)
  useEffect(() => {
    const email = searchParams.get('email');
    if (email) {
      form.setFieldsValue({ email });
    }
  }, [searchParams, form]);

  const handleSignUp = async (values: SignUpFormValues) => {
    setLoading(true);
    try {
      const callbackUrl = searchParams.get('callbackUrl') || '/';

      // Generate username from email (use the part before @)
      const username = values.email.split('@')[0];

      const { error } = await signUp.email({
        callbackURL: callbackUrl,
        email: values.email,
        name: username,
        password: values.password,
      });

      if (error) {
        interface ErrorWithDetails {
          details?: {
            cause?: {
              code?: string;
            };
          };
        }
        const isEmailDuplicate =
          error.code === 'FAILED_TO_CREATE_USER' &&
          // Postgres unique constraint violation
          (error as ErrorWithDetails)?.details?.cause?.code === '23505';

        if (isEmailDuplicate) {
          message.error(t('betterAuth.errors.emailExists'));
          return;
        }

        if (error.code === 'INVALID_EMAIL') {
          message.error(t('betterAuth.errors.emailInvalid'));
          return;
        }

        message.error(error.message || t('betterAuth.signup.error'));
        return;
      }

      // Redirect based on email verification requirement
      if (authEnv.NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION) {
        // Email verification required, redirect to verification notice page
        // callbackURL is already passed to signUp.email for verification link
        router.push(
          `/verify-email?email=${encodeURIComponent(values.email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        );
      } else {
        // Email verification not required, user is already logged in (autoSignIn: true)
        // Redirect to callback URL or home
        router.push(callbackUrl);
      }
    } catch {
      message.error(t('betterAuth.signup.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox align="center" justify="center" style={{ minHeight: '100vh' }}>
      <div className={styles.container}>
        <div className={styles.card}>
          <Flexbox align="center" gap={8} justify="center">
            <LobeHub size={48} />
          </Flexbox>

          <h1 className={styles.title}>{t('betterAuth.signup.title')}</h1>
          <p className={styles.subtitle}>{t('betterAuth.signup.subtitle')}</p>

          <Form form={form} layout="vertical" onFinish={handleSignUp} style={{ marginTop: '2rem' }}>
            <Form.Item
              name="email"
              rules={[
                { message: t('betterAuth.errors.emailRequired'), required: true },
                { message: t('betterAuth.errors.emailInvalid'), type: 'email' },
              ]}
            >
              <Input
                placeholder={t('betterAuth.signup.emailPlaceholder')}
                prefix={<Mail size={16} />}
                size="large"
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
                    const hasLetter = /[A-Za-z]/.test(value);
                    const hasNumber = /\d/.test(value);
                    if (hasLetter && hasNumber) {
                      return Promise.resolve();
                    }
                    return Promise.reject();
                  },
                },
              ]}
            >
              <Input.Password
                placeholder={t('betterAuth.signup.passwordPlaceholder')}
                prefix={<Lock size={16} />}
                size="large"
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
                prefix={<Lock size={16} />}
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button
                block
                htmlType="submit"
                icon={<ChevronRight size={16} />}
                iconPosition="end"
                loading={loading}
                size="large"
                type="primary"
              >
                {t('betterAuth.signup.submit')}
              </Button>
            </Form.Item>
          </Form>
        </div>

        <div className={styles.footer}>
          {t('betterAuth.signup.hasAccount')}{' '}
          <Link href={`/signin?${searchParams.toString()}`}>
            {t('betterAuth.signup.signinLink')}
          </Link>
        </div>
      </div>
    </Flexbox>
  );
}
