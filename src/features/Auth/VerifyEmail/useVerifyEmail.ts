import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sendVerificationEmail } from '@/libs/better-auth/auth-client';
import { toAbsoluteAuthCallbackUrl } from '@/utils/onboardingRedirect';

import { translateAuthError } from '../utils/translateAuthError';

interface UseVerifyEmailParams {
  callbackUrl: string;
  email: string | null;
}

export const useVerifyEmail = ({ email, callbackUrl }: UseVerifyEmailParams) => {
  const { t } = useTranslation(['auth', 'authError']);
  const [resending, setResending] = useState(false);
  /** Shown right under the Resend button instead of a toast */
  const [resendError, setResendError] = useState('');

  const handleResendEmail = async () => {
    if (!email) {
      setResendError(t('betterAuth.verifyEmail.resend.missingEmail'));
      return;
    }

    setResending(true);
    setResendError('');
    try {
      const result = await sendVerificationEmail({
        callbackURL: toAbsoluteAuthCallbackUrl(callbackUrl, window.location.origin),
        email,
      });
      if (result.error) {
        console.error('Error resending verification email:', result.error);
        setResendError(
          translateAuthError(result.error, t) || t('betterAuth.verifyEmail.resend.failed'),
        );
        return;
      }
      toast.success(t('betterAuth.verifyEmail.resend.success'));
    } catch (error) {
      console.error('Error resending verification email:', error);
      setResendError(t('betterAuth.verifyEmail.resend.failed'));
    } finally {
      setResending(false);
    }
  };

  return {
    handleResendEmail,
    resendError,
    resending,
  };
};
