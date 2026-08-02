import { toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { phoneNumber as phoneNumberApi, useSession } from '@/libs/better-auth/auth-client';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

type Step = 'phone' | 'otp';

interface UseVerifyPhoneParams {
  callbackUrl: string;
}

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
      // Better Auth / rate-limit style messages
      if (code === 'TOO_MANY_REQUESTS' || fallback.toLowerCase().includes('too many')) {
        return t('betterAuth.verifyPhone.errors.rateLimited');
      }
      return fallback || t('betterAuth.verifyPhone.errors.generic');
    }
  }
};

export const useVerifyPhone = ({ callbackUrl }: UseVerifyPhoneParams) => {
  const { t } = useTranslation('auth');
  const { refetch } = useSession();
  const [step, setStep] = useState<Step>('phone');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [phoneE164, setPhoneE164] = useState('');

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
        // Attach phone to the signed-in account (not a phone-only signup)
        updatePhoneNumber: true,
      });

      if (error) {
        toast.error(mapOtpError(error.code, error.message || '', t));
        return;
      }

      await refetch?.();
      toast.success(t('betterAuth.verifyPhone.success'));
      window.location.href = sanitizeRedirectPath(callbackUrl, '/');
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
