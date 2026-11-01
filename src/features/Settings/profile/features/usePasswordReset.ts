import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { saveToast } from '@/store/utils/saveToast';

export const usePasswordReset = (email?: string | null) => {
  const { t } = useTranslation('auth');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const requestReset = async () => {
    if (!email) return;

    try {
      setSending(true);
      const { requestPasswordReset } = await import('@/libs/better-auth/auth-client');
      // The better-auth client resolves with `{ data, error }` instead of
      // throwing, so a failed send would otherwise render as "link sent".
      const { error } = await requestPasswordReset({
        email,
        redirectTo: `/reset-password?email=${encodeURIComponent(email)}`,
      });
      if (error) throw error;
      setSent(true);
    } catch (error) {
      console.error('Failed to send reset password email:', error);
      saveToast(error, { retry: requestReset, title: t('profile.resetPasswordError') });
    } finally {
      setSending(false);
    }
  };

  return { requestReset, sending, sent };
};
