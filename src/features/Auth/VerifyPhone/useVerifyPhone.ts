import { toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getSession,
  phoneNumber as phoneNumberApi,
  useSession,
} from '@/libs/better-auth/auth-client';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

type Step = 'phone' | 'otp';

interface UseVerifyPhoneParams {
  callbackUrl: string;
}

type SessionUserPhone = {
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
};

const mapOtpError = (code: string | undefined, fallback: string, t: (key: string) => string) => {
  switch (code) {
    case 'INVALID_OTP': {
      return t('betterAuth.verifyPhone.errors.invalidOtp');
    }
    case 'OTP_EXPIRED': {
      return t('betterAuth.verifyPhone.errors.otpExpired');
    }
    case 'TOO_MANY_ATTEMPTS': {
      return t('betterAuth.verifyPhone.errors.tooManyAttempts');
    }
    case 'INVALID_PHONE_NUMBER': {
      return t('betterAuth.verifyPhone.errors.invalidPhone');
    }
    case 'PHONE_NUMBER_EXIST': {
      return t('betterAuth.verifyPhone.errors.phoneExists');
    }
    default: {
      if (code === 'TOO_MANY_REQUESTS' || fallback.toLowerCase().includes('too many')) {
        return t('betterAuth.verifyPhone.errors.rateLimited');
      }
      return fallback || t('betterAuth.verifyPhone.errors.generic');
    }
  }
};

/**
 * Better Auth's `updatePhoneNumber` verify path updates the DB but does **not**
 * rewrite the session cookie cache. With `session.cookieCache` enabled, a plain
 * refetch still returns stale `phoneNumberVerified: false` until logout or cache
 * expiry — force a DB-backed get-session that refreshes the cookie before leaving
 * the auth SPA.
 */
export const refreshSessionAfterPhoneVerify = async (): Promise<SessionUserPhone | null> => {
  const result = await getSession({ query: { disableCookieCache: true } });
  const user = (result as { data?: { user?: SessionUserPhone } | null } | null)?.data?.user;
  return user ?? null;
};

export const useVerifyPhone = ({ callbackUrl }: UseVerifyPhoneParams) => {
  const { t } = useTranslation('auth');
  const { refetch } = useSession();
  const [step, setStep] = useState<Step>('phone');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [phoneE164, setPhoneE164] = useState('');

  const finishVerified = async () => {
    await refreshSessionAfterPhoneVerify();
    await refetch?.({ query: { disableCookieCache: true } });
    toast.success(t('betterAuth.verifyPhone.success'));
    window.location.href = sanitizeRedirectPath(callbackUrl, '/');
  };

  const sendOtp = async (rawPhone: string): Promise<boolean> => {
    const normalized = normalizeIranianPhoneNumber(rawPhone);
    if (!normalized) {
      toast.error(t('betterAuth.verifyPhone.phone.invalid'));
      return false;
    }

    const { error } = await phoneNumberApi.sendOtp({ phoneNumber: normalized });
    if (error) {
      toast.error(mapOtpError(error.code, error.message || '', t));
      return false;
    }

    setPhoneE164(normalized);
    setStep('otp');
    return true;
  };

  const handleSendOtp = async (values: { phoneNumber: string }) => {
    setLoading(true);
    try {
      await sendOtp(values.phoneNumber);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!phoneE164 || resending) return;
    setResending(true);
    try {
      const ok = await sendOtp(phoneE164);
      if (ok) toast.success(t('betterAuth.verifyPhone.otp.resent'));
    } finally {
      setResending(false);
    }
  };

  const handleVerify = async (values: { code: string }) => {
    if (!phoneE164) return;
    setLoading(true);
    try {
      const { error } = await phoneNumberApi.verify({
        code: values.code,
        phoneNumber: phoneE164,
        updatePhoneNumber: true,
      });

      if (error) {
        if (error.code === 'PHONE_NUMBER_EXIST') {
          const user = await refreshSessionAfterPhoneVerify();
          if (user?.phoneNumberVerified && user.phoneNumber === phoneE164) {
            await refetch?.({ query: { disableCookieCache: true } });
            toast.success(t('betterAuth.verifyPhone.alreadyVerified'));
            window.location.href = sanitizeRedirectPath(callbackUrl, '/');
            return;
          }
        }
        toast.error(mapOtpError(error.code, error.message || '', t));
        return;
      }

      await finishVerified();
    } finally {
      setLoading(false);
    }
  };

  const handleBackToPhone = () => {
    setStep('phone');
  };

  return {
    handleBackToPhone,
    handleResend,
    handleSendOtp,
    handleVerify,
    loading,
    phoneDisplay: phoneE164,
    resending,
    step,
  };
};

export const exitVerifyPhoneFlow = (callbackUrl: string) => {
  window.location.assign(sanitizeRedirectPath(callbackUrl, '/'));
};
