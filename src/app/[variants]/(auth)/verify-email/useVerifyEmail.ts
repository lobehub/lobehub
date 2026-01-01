import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { sendVerificationEmail } from '@/libs/better-auth/auth-client';

interface UseVerifyEmailParams {
  callbackUrl: string;
  email: string | null;
}

export const useVerifyEmail = ({ email, callbackUrl }: UseVerifyEmailParams) => {
  const { t } = useTranslation('auth');
  const [resending, setResending] = useState(false);

  const handleResendEmail = async () => {
    if (!email) {
      message.error(t('betterAuth.verifyEmail.resend.noEmail'));
      return;
    }

    setResending(true);
    try {
      const result = await sendVerificationEmail({ callbackURL: callbackUrl, email });
      if (result.error) {
        message.error(result.error.message || t('betterAuth.verifyEmail.resend.error'));
        return;
      }
      message.success(t('betterAuth.verifyEmail.resend.success'));
    } catch (error) {
      console.error('Error resending verification email:', error);
      message.error(t('betterAuth.verifyEmail.resend.error'));
    } finally {
      setResending(false);
    }
  };

  return {
    handleResendEmail,
    resending,
  };
};
