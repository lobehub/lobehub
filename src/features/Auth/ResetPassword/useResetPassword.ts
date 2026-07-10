import { Form } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { resetPassword } from '@/libs/better-auth/auth-client';

interface ResetPasswordFormValues {
  confirmPassword: string;
  newPassword: string;
}

interface UseResetPasswordParams {
  email: string | null;
  onSuccessRedirect: (url: string) => void;
  token: string | null;
}

export const useResetPassword = ({ email, token, onSuccessRedirect }: UseResetPasswordParams) => {
  const { t } = useTranslation('auth');
  const [form] = Form.useForm<ResetPasswordFormValues>();
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async (values: ResetPasswordFormValues) => {
    if (!token) {
      message.error(t('betterAuth.resetPassword.invalidToken'));
      return;
    }

    setLoading(true);
    try {
      const result = await resetPassword({ newPassword: values.newPassword, token });
      if (result.error) {
        message.error(result.error.message || t('betterAuth.resetPassword.error'));
        return;
      }
      message.success(t('betterAuth.resetPassword.success'));
      const redirectUrl = email ? `/signin?email=${encodeURIComponent(email)}` : '/signin';
      onSuccessRedirect(redirectUrl);
    } catch (error) {
      console.error('Reset password error:', error);
      message.error(t('betterAuth.resetPassword.error'));
    } finally {
      setLoading(false);
    }
  };

  return {
    form,
    handleResetPassword,
    loading,
  };
};
