import { Button, Icon, Input, Text } from '@lobehub/ui';
import { type FormInstance, type InputRef } from 'antd';
import { Form } from 'antd';
import { ChevronRight, KeyRound, Smartphone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '../../../../features/AuthCard';

interface PhoneFormValues {
  code?: string;
  phone?: string;
}

export interface SignInPhoneStepProps {
  cooldown: number;
  form: FormInstance<PhoneFormValues>;
  loading: boolean;
  mode: 'input' | 'verify';
  onBackToEmail: () => void;
  onSendCode: (values: { phone: string }) => Promise<void>;
  onSubmitCode: (values: { code: string }) => Promise<void>;
  phone?: string;
}

export const SignInPhoneStep = ({
  cooldown,
  form,
  loading,
  mode,
  onBackToEmail,
  onSendCode,
  onSubmitCode,
  phone,
}: SignInPhoneStepProps) => {
  const { t } = useTranslation('auth');
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  return (
    <AuthCard
      title={'Agent teammates that grow with you'}
      footer={
        <Text fontSize={13} type={'secondary'}>
          <a
            style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={onBackToEmail}
          >
            {t('betterAuth.signin.backToEmail')}
          </a>
        </Text>
      }
      subtitle={
        mode === 'input'
          ? t('betterAuth.signin.phoneStep.subtitle')
          : t('betterAuth.signin.phoneVerify.subtitle')
      }
    >
      {mode === 'verify' && phone && <Text fontSize={20}>{phone}</Text>}

      <Form
        form={form}
        layout="vertical"
        style={mode === 'verify' ? { marginTop: 12 } : undefined}
        onFinish={(values) =>
          mode === 'input'
            ? onSendCode(values as { phone: string })
            : onSubmitCode(values as { code: string })
        }
      >
        <Form.Item
          name={mode === 'input' ? 'phone' : 'code'}
          style={{ marginBottom: 0 }}
          rules={
            mode === 'input'
              ? [{ message: t('betterAuth.errors.phoneRequired'), required: true }]
              : [{ message: t('betterAuth.errors.otpRequired'), required: true }]
          }
        >
          <Input
            ref={inputRef}
            size="large"
            placeholder={
              mode === 'input'
                ? t('betterAuth.signin.phonePlaceholder')
                : t('betterAuth.signin.phoneCodePlaceholder')
            }
            prefix={
              <Icon
                icon={mode === 'input' ? Smartphone : KeyRound}
                style={{
                  marginInline: 6,
                }}
              />
            }
            style={{
              padding: 6,
            }}
            suffix={
              <Button
                icon={ChevronRight}
                loading={loading}
                variant={'filled'}
                title={
                  mode === 'input'
                    ? t('betterAuth.signin.sendCode')
                    : t('betterAuth.signin.submitPhoneCode')
                }
                onClick={() => form.submit()}
              />
            }
          />
        </Form.Item>
      </Form>

      {mode === 'verify' && (
        <Text fontSize={13} style={{ marginTop: 12 }} type={'secondary'}>
          {cooldown > 0
            ? t('betterAuth.signin.resendIn', { seconds: cooldown })
            : t('betterAuth.signin.codeSent')}
        </Text>
      )}
    </AuthCard>
  );
};
