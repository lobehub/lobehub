import { Block, Icon } from '@lobehub/ui';
import { Button, InputPassword, Text } from '@lobehub/ui/base-ui';
import { Form } from '@lobehub/ui/base-ui/form';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { form, loading } = useResetPassword({
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
    <Form form={form} gap={0} layout="vertical">
      <Form.Field
        name="newPassword"
        style={{ gap: 0, paddingBlock: '0 24px' }}
        validate={(value: string) => {
          if (!value) return t('betterAuth.errors.passwordRequired');
          if (value.length < 8) return t('betterAuth.errors.passwordMinLength');
          if (value.length > 64) return t('betterAuth.errors.passwordMaxLength');
        }}
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
      </Form.Field>
      <Form.Field
        deps={['newPassword']}
        name="confirmPassword"
        style={{ gap: 0, paddingBlock: '0 24px' }}
        validate={(value: string, values: { newPassword: string }) => {
          if (!value) return t('betterAuth.resetPassword.confirmPasswordRequired');
          if (values.newPassword !== value) return t('betterAuth.resetPassword.passwordMismatch');
        }}
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
      </Form.Field>
      <Button block htmlType="submit" loading={loading} size="large" type="primary">
        {t('betterAuth.resetPassword.submit')}
      </Button>
    </Form>
  );
};
