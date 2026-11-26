import { toast } from '@lobehub/ui';
import { useForm } from '@lobehub/ui/form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resetPassword } from '@/libs/better-auth/auth-client';

import { translateAuthError } from '../utils/translateAuthError';

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
  const { t } = useTranslation(['auth', 'authError']);
  const [loading, setLoading] = useState(false);
  /** Shown above the submit button instead of a toast, cleared when the user edits a field */
  const [formError, setFormError] = useState('');

  const handleResetPassword = async (values: ResetPasswordFormValues) => {
    if (!token) {
      setFormError(t('betterAuth.resetPassword.linkExpired'));
      return;
    }

    setLoading(true);
    setFormError('');
    try {
      const result = await resetPassword({ newPassword: values.newPassword, token });
      if (result.error) {
        console.error('Reset password error:', result.error);
        // An expired or reused link is the common failure; it needs a new email, not a retry
        setFormError(
          result.error.code === 'INVALID_TOKEN'
            ? t('betterAuth.resetPassword.linkExpired')
            : translateAuthError(result.error, t) || t('betterAuth.resetPassword.failed'),
        );
        return;
      }
      toast.success(t('betterAuth.resetPassword.success'));
      const redirectUrl = email ? `/signin?email=${encodeURIComponent(email)}` : '/signin';
      onSuccessRedirect(redirectUrl);
    } catch (error) {
      console.error('Reset password error:', error);
      setFormError(t('betterAuth.errors.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const form = useForm<ResetPasswordFormValues>({
    initialValues: { confirmPassword: '', newPassword: '' },
    onValuesChange: () => setFormError(''),
    onSubmit: handleResetPassword,
  });

  return {
    form,
    formError,
    loading,
  };
};
