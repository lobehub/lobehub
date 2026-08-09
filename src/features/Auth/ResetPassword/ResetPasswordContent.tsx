import { Block, Icon, InputPassword, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PASSWORD_MIN_LENGTH } from '@/libs/better-auth/plugins/password-policy';

import { useResetPassword } from './useResetPassword';

interface ResetPasswordContentProps {
  email: string | null;
  onSuccessRedirect: (url: string) => void;
  token: string | null;
}

export const ResetPasswordContent = ({
  email,
  token,
  onSuccessRedirect,
}: ResetPasswordContentProps) => {
  const { t } = useTranslation('auth');
  const { form, handleResetPassword, loading } = useResetPassword({
    email,
    onSuccessRedirect,
    token,
  });

  if (!token) {
    return (
      <Block padding={24}>
        <Text align={'center'} fontSize={16}>
          {t('betterAuth.resetPassword.invalidToken')}
        </Text>
      </Block>
    );
  }

  return (
    <Form form={form} layout="vertical" onFinish={handleResetPassword}>
      <Form.Item
        name="newPassword"
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
          placeholder={t('betterAuth.resetPassword.newPasswordPlaceholder')}
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
        dependencies={['newPassword']}
        name="confirmPassword"
        rules={[
          { message: t('betterAuth.resetPassword.confirmPasswordRequired'), required: true },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
              return Promise.reject(new Error(t('betterAuth.resetPassword.passwordMismatch')));
            },
          }),
        ]}
      >
        <InputPassword
          autoComplete="new-password"
          placeholder={t('betterAuth.resetPassword.confirmPasswordPlaceholder')}
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
      <Form.Item style={{ marginBottom: 0 }}>
        <Button block htmlType="submit" loading={loading} size="large" type="primary">
          {t('betterAuth.resetPassword.submit')}
        </Button>
      </Form.Item>
    </Form>
  );
};
