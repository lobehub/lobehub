'use client';

import { Button, Icon, Text } from '@lobehub/ui';
import { Form, Input as AntInput } from 'antd';
import { Lock, Mail, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CheckPhoneResponseData } from '@/app/(backend)/api/auth/check-phone/route';
import { message } from '@/components/AntdStaticMethods';
import { normalizeCnPhoneNumber } from '@/libs/auth/phone';
import { updateUser } from '@/libs/better-auth/auth-client';

import { AuthCard } from '../../../../../features/AuthCard';
import { useAuthServerConfigStore } from '../../_layout/AuthServerConfigProvider';
import { normalizeAuthCallbackUrl, postPhoneAuth } from '../../phoneAuth';
import { SignInPhoneStep } from '../../signin/SignInPhoneStep';
import { type SignUpFormValues } from './useSignUp';
import { useSignUp } from './useSignUp';

interface PhoneSignUpFormValues {
  code: string;
  phone: string;
}

interface PhoneSignUpProfileValues {
  confirmPassword: string;
  password: string;
  username: string;
}

const isUsernameConflictError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const normalizedError = JSON.stringify(error).toLowerCase();

  return (
    normalizedError.includes('users_username_unique') ||
    normalizedError.includes('username_taken') ||
    normalizedError.includes('duplicate key value') ||
    normalizedError.includes('"status":409') ||
    normalizedError.includes('"code":"conflict"') ||
    (normalizedError.includes('username') && normalizedError.includes('already exists'))
  );
};

const BetterAuthSignUpForm = () => {
  const [form] = Form.useForm<SignUpFormValues>();
  const [phoneForm] = Form.useForm<PhoneSignUpFormValues>();
  const [phoneProfileForm] = Form.useForm<PhoneSignUpProfileValues>();
  const { businessElement, loading: emailLoading, onSubmit } = useSignUp();

  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const enablePhoneAuth = useAuthServerConfigStore((s) => s.serverConfig.enablePhoneAuth || false);
  const enablePhoneSignup = useAuthServerConfigStore(
    (s) => s.serverConfig.enablePhoneSignup || false,
  );
  const phoneAuthResendInterval = useAuthServerConfigStore(
    (s) => s.serverConfig.phoneAuthResendInterval || 60,
  );
  const [phoneStep, setPhoneStep] = useState<'input' | 'profile' | 'verify'>('input');
  const [phone, setPhone] = useState('');
  const [phoneCooldown, setPhoneCooldown] = useState(0);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const searchParamsString = searchParams.toString();

  useEffect(() => {
    const email = searchParams.get('email');
    if (!email || enablePhoneSignup) return;

    form.setFieldsValue({ email });
  }, [searchParamsString, enablePhoneSignup, form, searchParams]);

  useEffect(() => {
    const phoneParam = searchParams.get('phone');
    if (!enablePhoneSignup || !phoneParam) return;

    const normalized = normalizeCnPhoneNumber(phoneParam);
    if (!normalized) return;

    setPhone(normalized);
    phoneForm.setFieldValue('phone', normalized);
  }, [enablePhoneSignup, phoneForm, searchParams, searchParamsString]);

  useEffect(() => {
    if (phoneCooldown <= 0) return;

    const timer = window.setTimeout(() => {
      setPhoneCooldown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phoneCooldown]);

  const signInParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (enablePhoneAuth) {
      params.set('mode', 'phone');
      if (phone) params.set('phone', phone);
    } else {
      params.delete('mode');
      params.delete('phone');
    }

    return params.toString();
  }, [enablePhoneAuth, phone, searchParams]);

  const footer = (
    <Text>
      {t('betterAuth.signup.hasAccount')}{' '}
      <Link href={`/signin?${signInParams}`}>{t('betterAuth.signup.signinLink')}</Link>
    </Text>
  );

  const checkPhoneRegistration = async (
    normalizedPhone: string,
  ): Promise<CheckPhoneResponseData | null> => {
    try {
      const response = await fetch('/api/auth/check-phone', {
        body: JSON.stringify({ phone: normalizedPhone }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data: CheckPhoneResponseData = await response.json();

      if (!response.ok) {
        message.error(t('betterAuth.signup.error'));
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error checking phone registration:', error);
      message.error(t('betterAuth.signup.error'));
      return null;
    }
  };

  const handleSendPhoneCode = async (values: Pick<PhoneSignUpFormValues, 'phone'>) => {
    const normalizedPhone = normalizeCnPhoneNumber(values.phone);

    if (!normalizedPhone) {
      message.error(t('betterAuth.errors.phoneInvalid'));
      return;
    }

    setPhoneLoading(true);
    try {
      const checkResult = await checkPhoneRegistration(normalizedPhone);
      if (!checkResult) return;

      if (checkResult.exists) {
        message.error(t('betterAuth.errors.phoneExists'));
        const callbackUrl = searchParams.get('callbackUrl') || '/';
        router.push(
          `/signin?mode=phone&phone=${encodeURIComponent(normalizedPhone)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        );
        return;
      }

      const result = await postPhoneAuth(t, '/phone-number/send-otp', {
        phoneNumber: normalizedPhone,
      });

      if (!result.success) {
        message.error(result.errorMessage || t('betterAuth.signin.phoneCodeError'));
        return;
      }

      setPhone(normalizedPhone);
      setPhoneStep('verify');
      setPhoneCooldown(phoneAuthResendInterval);
      phoneForm.setFieldValue('phone', normalizedPhone);
      phoneForm.setFieldValue('code', '');
      message.success(t('betterAuth.signin.phoneCodeSent'));
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleVerifyPhoneCode = async (values: Pick<PhoneSignUpFormValues, 'code'>) => {
    if (!phone) {
      message.error(t('betterAuth.errors.phoneRequired'));
      return;
    }

    setPhoneLoading(true);
    try {
      const result = await postPhoneAuth(t, '/phone-number/verify', {
        code: values.code,
        phoneNumber: phone,
      });

      if (!result.success) {
        message.error(result.errorMessage || t('betterAuth.signin.phoneVerifyError'));
        return;
      }

      setPhoneStep('profile');
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleCompletePhoneSignup = async (values: PhoneSignUpProfileValues) => {
    setPhoneLoading(true);
    try {
      const updateResult = await updateUser({
        name: values.username,
        username: values.username,
      });

      if (updateResult.error) {
        if (isUsernameConflictError(updateResult.error)) {
          message.error(t('profile.usernameDuplicate'));
          return;
        }

        message.error(updateResult.error.message || t('betterAuth.signup.error'));
        return;
      }

      const setPasswordResult = await postPhoneAuth(t, '/set-password', {
        newPassword: values.password,
      });
      if (!setPasswordResult.success) {
        message.error(setPasswordResult.errorMessage || t('betterAuth.signup.error'));
        return;
      }

      const callbackUrl = normalizeAuthCallbackUrl(searchParams.get('callbackUrl') || '/');
      router.push(callbackUrl);
    } catch (error) {
      console.error('Complete phone signup error:', error);
      message.error(t('betterAuth.signup.error'));
    } finally {
      setPhoneLoading(false);
    }
  };

  if (enablePhoneSignup) {
    if (phoneStep === 'profile') {
      return (
        <AuthCard
          footer={footer}
          subtitle={t('betterAuth.signup.phoneProfile.subtitle')}
          title={t('betterAuth.signup.title')}
        >
          <Text fontSize={20} style={{ marginBottom: 12 }}>
            {phone}
          </Text>
          <Form
            form={phoneProfileForm}
            layout="vertical"
            onFinish={(values) => handleCompletePhoneSignup(values as PhoneSignUpProfileValues)}
          >
            <Form.Item
              name="username"
              rules={[{ message: t('betterAuth.errors.usernameRequired'), required: true }]}
            >
              <AntInput
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
              <AntInput.Password
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
              <AntInput.Password
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
              <Button block htmlType="submit" loading={phoneLoading} size="large" type="primary">
                {t('betterAuth.signup.submit')}
              </Button>
            </Form.Item>
          </Form>
        </AuthCard>
      );
    }

    return (
      <SignInPhoneStep
        cooldown={phoneCooldown}
        footer={footer}
        form={phoneForm as any}
        loading={phoneLoading}
        mode={phoneStep === 'verify' ? 'verify' : 'input'}
        phone={phone}
        showBackLink={false}
        submitCodeText={t('betterAuth.signup.submitPhoneCode')}
        submitInputText={t('betterAuth.signin.phoneContinue')}
        title={t('betterAuth.signup.title')}
        action={
          phoneStep === 'verify' ? (
            <a
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => {
                setPhoneStep('input');
                setPhone('');
                setPhoneCooldown(0);
                phoneForm.resetFields();
              }}
            >
              {t('betterAuth.signin.changePhone')}
            </a>
          ) : null
        }
        onSendCode={handleSendPhoneCode}
        onSubmitCode={handleVerifyPhoneCode}
      />
    );
  }

  return (
    <AuthCard
      footer={footer}
      subtitle={t('betterAuth.signup.subtitle')}
      title={t('betterAuth.signup.title')}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item
          name="username"
          rules={[{ message: t('betterAuth.errors.usernameRequired'), required: true }]}
        >
          <AntInput
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
          <AntInput
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
          <AntInput.Password
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
          <AntInput.Password
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
          <Button block htmlType="submit" loading={emailLoading} size="large" type="primary">
            {t('betterAuth.signup.submit')}
          </Button>
        </Form.Item>
      </Form>
    </AuthCard>
  );
};

export default BetterAuthSignUpForm;
