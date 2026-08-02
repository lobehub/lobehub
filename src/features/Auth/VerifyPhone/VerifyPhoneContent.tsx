import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Form, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { isValidIranianPhoneNumber } from '@/libs/better-auth/phone';

import { useVerifyPhone } from './useVerifyPhone';

const styles = createStaticStyles(({ css }) => ({
  // Stretch OTP cells across the same width as the block action buttons below.
  otp: css`
    display: flex;
    justify-content: space-between;
    width: 100%;

    .ant-otp-input-wrapper {
      flex: 1;
      min-width: 0;
    }

    .ant-otp-input {
      width: 100%;
    }
  `,
}));

interface VerifyPhoneContentProps {
  callbackUrl: string;
}

export const VerifyPhoneContent = ({ callbackUrl }: VerifyPhoneContentProps) => {
  const { t } = useTranslation('auth');
  const [form] = Form.useForm<{ phoneNumber: string; code: string }>();
  const {
    handleBackToPhone,
    handleResend,
    handleSendOtp,
    handleVerify,
    loading,
    phoneDisplay,
    resending,
    step,
  } = useVerifyPhone({ callbackUrl });

  if (step === 'otp') {
    return (
      <Flexbox gap={16}>
        <Text type="secondary">
          {t('betterAuth.verifyPhone.otp.description', { phone: phoneDisplay })}
        </Text>
        <Form form={form} layout="vertical" onFinish={handleVerify}>
          <Form.Item
            name="code"
            rules={[
              { message: t('betterAuth.verifyPhone.otp.required'), required: true },
              { len: 6, message: t('betterAuth.verifyPhone.otp.length') },
            ]}
          >
            <Input.OTP autoFocus className={styles.otp} length={6} size="large" />
          </Form.Item>
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            {t('betterAuth.verifyPhone.otp.submit')}
          </Button>
        </Form>
        <Button block loading={resending} size="large" type="default" onClick={handleResend}>
          {t('betterAuth.verifyPhone.otp.resend')}
        </Button>
        <Button
          block
          size="large"
          type="text"
          onClick={() => {
            form.resetFields(['code']);
            handleBackToPhone();
          }}
        >
          {t('betterAuth.verifyPhone.otp.changePhone')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Form form={form} layout="vertical" onFinish={handleSendOtp}>
      <Form.Item
        name="phoneNumber"
        rules={[
          { message: t('betterAuth.verifyPhone.phone.required'), required: true },
          {
            validator: async (_, value) => {
              if (!value || isValidIranianPhoneNumber(value)) return;
              throw new Error(t('betterAuth.verifyPhone.phone.invalid'));
            },
          },
        ]}
      >
        <Input
          autoFocus
          autoComplete="tel"
          inputMode="tel"
          placeholder={t('betterAuth.verifyPhone.phone.placeholder')}
          size="large"
        />
      </Form.Item>
      <Button block htmlType="submit" loading={loading} size="large" type="primary">
        {t('betterAuth.verifyPhone.phone.submit')}
      </Button>
    </Form>
  );
};
