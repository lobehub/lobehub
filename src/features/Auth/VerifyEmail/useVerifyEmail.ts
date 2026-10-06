import { toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sendVerificationEmail } from '@/libs/better-auth/auth-client';
import { toAbsoluteAuthCallbackUrl } from '@/utils/onboardingRedirect';

interface UseVerifyEmailParams {
  callbackUrl: string;
  email: string | null;
}

export const useVerifyEmail = ({ email, callbackUrl }: UseVerifyEmailParams) => {
  const { t } = useTranslation('auth');
  const [resending, setResending] = useState(false);

  const handleResendEmail = async () => {
    if (!email) {
      toast.error(t('betterAuth.verifyEmail.resend.noEmail'));
      return;
    }

    setResending(true);
    try {
      const result = await sendVerificationEmail({
        callbackURL: toAbsoluteAuthCallbackUrl(callbackUrl, window.location.origin),
        email,
      });
      if (result.error) {
        toast.error(result.error.message || t('betterAuth.verifyEmail.resend.error'));
        return;
      }
      toast.success(t('betterAuth.verifyEmail.resend.success'));
    } catch (error) {
      console.error('Error resending verification email:', error);
      toast.error(t('betterAuth.verifyEmail.resend.error'));
    } finally {
      setResending(false);
    }
  };

  return {
    handleResendEmail,
    resending,
  };
};
