'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Form, type FormInstance, type InputRef } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Smartphone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { OtpCodeInput } from '@/features/Auth/OtpCodeInput';
import AuthCard from '@/features/AuthCard';
import { AuthAgreement, useAuthAgreement } from '@/features/AuthShell';
import { isValidIranianPhoneNumber } from '@/libs/better-auth/phone';

const styles = createStaticStyles(({ css, cssVar }) => ({
  inlineLink: css`
    cursor: pointer;
    color: ${cssVar.colorPrimary};
    text-decoration: underline;
  `,
}));

export interface SignInPhoneStepProps {
  loading: boolean;
  onBackToEmail: () => void;
  onResend: () => Promise<void>;
  onSendOtp: (values: { phoneNumber: string }) => Promise<void>;
  onVerifyOtp: (values: { code: string }) => Promise<void>;
  otpForm: FormInstance<{ code: string }>;
  phoneDisplay?: string;
  phoneForm: FormInstance<{ phoneNumber: string }>;
  resending: boolean;
  step: 'phone' | 'phoneOtp';
}

export const SignInPhoneStep = ({
  loading,
  onBackToEmail,
  onSendOtp,
  onVerifyOtp,
  onResend,
  otpForm,
  phoneDisplay,
  phoneForm,
  resending,
  step,
}: SignInPhoneStepProps) => {
  const { t } = useTranslation('auth');
  const { agreementChecked, continueWithAgreement, setAgreementChecked } = useAuthAgreement();
  const phoneInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (step === 'phone') phoneInputRef.current?.focus();
  }, [step]);

  if (step === 'phoneOtp') {
    return (
      <AuthCard title={t('betterAuth.signin.phone.otpTitle', { appName: BRANDING_NAME })}>
        <Text style={{ marginBottom: 16 }} type="secondary">
          {t('betterAuth.signin.phone.otpDescription', { phone: phoneDisplay })}
        </Text>
        <Form form={otpForm} layout="vertical" onFinish={(values) => void onVerifyOtp(values)}>
          <Form.Item
            name="code"
            rules={[
              { message: t('betterAuth.verifyPhone.otp.required'), required: true },
              { len: 6, message: t('betterAuth.verifyPhone.otp.length') },
            ]}
          >
            <OtpCodeInput autoFocus />
          </Form.Item>
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {t('betterAuth.signin.phone.submitOtp')}
          </Button>
        </Form>
        <Flexbox gap={8} style={{ marginTop: 16 }}>
          <Button
            block
            disabled={resending}
            loading={resending}
            type="text"
            onClick={() => void onResend()}
          >
            {t('betterAuth.verifyPhone.otp.resend')}
          </Button>
          <Text align="center" fontSize={13} type="secondary">
            <a
              className={styles.inlineLink}
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
              {t('betterAuth.signin.phone.useEmail')}
            </a>
          </Text>
        </Flexbox>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('betterAuth.signin.phone.title', { appName: BRANDING_NAME })}>
      <Text style={{ marginBottom: 16 }} type="secondary">
        {t('betterAuth.signin.phone.description')}
      </Text>
      <Form
        form={phoneForm}
        layout="vertical"
        onFinish={(values) =>
          continueWithAgreement(() => {
            void onSendOtp(values);
          })
        }
      >
        <Form.Item
          name="phoneNumber"
          rules={[
            { message: t('betterAuth.verifyPhone.phone.required'), required: true },
            {
              validator: async (_, value) => {
                if (!value || isValidIranianPhoneNumber(String(value))) return;
                throw new Error(t('betterAuth.verifyPhone.phone.invalid'));
              },
            },
          ]}
        >
          <Input
            autoComplete="tel"
            inputMode="tel"
            placeholder={t('betterAuth.verifyPhone.phone.placeholder')}
            prefix={<Icon icon={Smartphone} style={{ marginInline: 6 }} />}
            ref={phoneInputRef}
            size="large"
          />
        </Form.Item>
        <AuthAgreement checked={agreementChecked} onChange={setAgreementChecked} />
        <Button block htmlType="submit" loading={loading} size="large" type="primary">
          {t('betterAuth.signin.phone.sendCode')}
        </Button>
      </Form>
      <Text align="center" fontSize={13} style={{ marginTop: 16 }} type="secondary">
        <a
          className={styles.inlineLink}
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
          {t('betterAuth.signin.phone.useEmail')}
        </a>
      </Text>
    </AuthCard>
  );
};
