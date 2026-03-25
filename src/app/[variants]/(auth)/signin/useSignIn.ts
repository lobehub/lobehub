import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Form } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CheckUserResponseData } from '@/app/(backend)/api/auth/check-user/route';
import { type ResolveUsernameResponseData } from '@/app/(backend)/api/auth/resolve-username/route';
import { useBusinessSignin } from '@/business/client/hooks/useBusinessSignin';
import { message } from '@/components/AntdStaticMethods';
import { normalizeCnPhoneNumber } from '@/libs/auth/phone';
import { requestPasswordReset, signIn } from '@/libs/better-auth/auth-client';
import { isBuiltinProvider, normalizeProviderId } from '@/libs/better-auth/utils/client';

import { useAuthServerConfigStore } from '../_layout/AuthServerConfigProvider';
import { EMAIL_REGEX, USERNAME_REGEX } from './SignInEmailStep';

const LAST_AUTH_PROVIDER_KEY = 'lobehub:auth:last-provider:v1';

/**
 * Normalize callback URL to support IP address access
 * If callback URL is root path, use current host origin
 */
const normalizeCallbackUrl = (callbackUrl: string): string => {
  if (typeof window !== 'undefined' && callbackUrl === '/') {
    return `${window.location.origin}/`;
  }
  return callbackUrl;
};

type Step = 'email' | 'password' | 'phone';

interface PhoneAuthResult {
  data?: any;
  errorMessage?: string;
  success: boolean;
}

interface SignInFormValues {
  email: string;
  password: string;
}

interface PhoneSignInFormValues {
  code: string;
  phone: string;
}

interface ResolvedEmailResult {
  email: string;
  identifierType: 'email' | 'username';
}

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const maybeStatus = (error as any).status ?? (error as any).statusCode;
  return typeof maybeStatus === 'number' ? maybeStatus : undefined;
};

export const useSignIn = () => {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const enableMagicLink = useAuthServerConfigStore((s) => s.serverConfig.enableMagicLink || false);
  const enablePhoneAuth = useAuthServerConfigStore((s) => s.serverConfig.enablePhoneAuth || false);
  const phoneAuthResendInterval = useAuthServerConfigStore(
    (s) => s.serverConfig.phoneAuthResendInterval || 60,
  );
  const disableEmailPassword = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailPassword || false,
  );
  const [form] = Form.useForm<SignInFormValues>();
  const [phoneForm] = Form.useForm<PhoneSignInFormValues>();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneMode, setPhoneMode] = useState<'input' | 'verify'>('input');
  const [phoneCooldown, setPhoneCooldown] = useState(0);
  const [isSocialOnly, setIsSocialOnly] = useState(false);
  const [lastAuthProvider] = useState(() => {
    try {
      return localStorage.getItem(LAST_AUTH_PROVIDER_KEY);
    } catch {
      return null;
    }
  });
  const serverConfigInit = useAuthServerConfigStore((s) => s.serverConfigInit);
  const oAuthSSOProviders = useAuthServerConfigStore((s) => s.serverConfig.oAuthSSOProviders) || [];
  const { ssoProviders, preSocialSigninCheck, getAdditionalData } = useBusinessSignin();

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) form.setFieldValue('email', emailParam);
  }, [searchParams, form]);

  useEffect(() => {
    if (searchParams.get('mode') !== 'phone' || !enablePhoneAuth) return;

    setStep('email');
  }, [enablePhoneAuth, searchParams]);

  useEffect(() => {
    if (phoneCooldown <= 0) return;

    const timer = window.setTimeout(() => {
      setPhoneCooldown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phoneCooldown]);

  const getPhoneAuthErrorMessage = (error: string) => {
    switch (error) {
      case 'Invalid OTP': {
        return t('betterAuth.errors.otpInvalid');
      }
      case 'Invalid phone number': {
        return t('betterAuth.errors.phoneInvalid');
      }
      case 'OTP expired':
      case 'OTP not found': {
        return t('betterAuth.errors.otpExpired');
      }
      case 'Too many attempts': {
        return t('betterAuth.errors.otpTooManyAttempts');
      }
      default: {
        return error;
      }
    }
  };

  const postPhoneAuth = async (
    path: string,
    body: Record<string, unknown>,
  ): Promise<PhoneAuthResult> => {
    try {
      const response = await fetch(`/api/auth${path}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMessage =
          data?.message || data?.error?.message || data?.code || t('betterAuth.signin.error');

        return {
          errorMessage: getPhoneAuthErrorMessage(errorMessage),
          success: false,
        };
      }

      return { data, success: true };
    } catch (error) {
      console.error(`[phone-auth:${path}]`, error);

      return {
        errorMessage: t('betterAuth.signin.error'),
        success: false,
      };
    }
  };

  const handleSendMagicLink = async (targetEmail?: string) => {
    try {
      const emailValue =
        targetEmail ||
        (await form
          .validateFields(['email'])
          .then((v) => v.email as string)
          .catch(() => null));
      if (!emailValue) return;

      const callbackUrl = normalizeCallbackUrl(searchParams.get('callbackUrl') || '/');
      const { error } = await signIn.magicLink({ callbackURL: callbackUrl, email: emailValue });
      if (error) {
        message.error(error.message || t('betterAuth.signin.magicLinkError'));
        return;
      }
      message.success(t('betterAuth.signin.magicLinkSent'));
    } catch (error) {
      if (!(error as any)?.errorFields) {
        console.error('Magic link error:', error);
        message.error(t('betterAuth.signin.magicLinkError'));
      }
    }
  };

  const resolveEmailFromIdentifier = async (
    identifier: string,
  ): Promise<ResolvedEmailResult | null> => {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) return null;

    const isEmailIdentifier = EMAIL_REGEX.test(trimmedIdentifier);
    if (isEmailIdentifier)
      return { email: trimmedIdentifier.toLowerCase(), identifierType: 'email' };

    if (!USERNAME_REGEX.test(trimmedIdentifier)) {
      message.error(t('betterAuth.errors.emailInvalid'));
      return null;
    }

    try {
      const response = await fetch('/api/auth/resolve-username', {
        body: JSON.stringify({ username: trimmedIdentifier }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data: ResolveUsernameResponseData = await response.json();
      if (!response.ok || !data.exists || !data.email) {
        message.error(t('betterAuth.errors.usernameNotRegistered'));
        return null;
      }
      return { email: data.email, identifierType: 'username' };
    } catch (error) {
      console.error('Error resolving username:', error);
      message.error(t('betterAuth.signin.error'));
      return null;
    }
  };

  const handleCheckUser = async (values: Pick<SignInFormValues, 'email'>) => {
    setLoading(true);
    try {
      const resolvedEmail = await resolveEmailFromIdentifier(values.email);
      if (!resolvedEmail) return;

      const { email: targetEmail, identifierType } = resolvedEmail;
      const response = await fetch('/api/auth/check-user', {
        body: JSON.stringify({ email: targetEmail }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data: CheckUserResponseData = await response.json();

      if (!data.exists) {
        if (identifierType === 'username') {
          message.error(t('betterAuth.errors.usernameNotRegistered'));
          return;
        }
        const callbackUrl = searchParams.get('callbackUrl') || '/';
        router.push(
          `/signup?email=${encodeURIComponent(targetEmail)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        );
        return;
      }

      setEmail(targetEmail);
      if (data.hasPassword) {
        setStep('password');
        return;
      }

      if (enableMagicLink) {
        await handleSendMagicLink(targetEmail);
        return;
      }

      // User has no password and magic link is disabled, they can only sign in via social
      setIsSocialOnly(true);
    } catch (error) {
      console.error('Error checking user:', error);
      message.error(t('betterAuth.signin.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (values: Pick<SignInFormValues, 'password'>) => {
    setLoading(true);
    try {
      const callbackUrl = normalizeCallbackUrl(searchParams.get('callbackUrl') || '/');
      const result = await signIn.email(
        { callbackURL: callbackUrl, email, password: values.password },
        { onSuccess: () => router.push(callbackUrl) },
      );

      if (result.error) {
        const status = getErrorStatus(result.error);

        if (status === 403) {
          router.push(
            `/verify-email?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
          );
          return;
        }

        message.error(result.error.message || t('betterAuth.signin.error'));
      }
    } catch (error) {
      console.error('Sign in error:', error);
      message.error(t('betterAuth.signin.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneCode = async (values: Pick<PhoneSignInFormValues, 'phone'>) => {
    const normalizedPhone = normalizeCnPhoneNumber(values.phone);

    if (!normalizedPhone) {
      message.error(t('betterAuth.errors.phoneInvalid'));
      return;
    }

    setLoading(true);
    try {
      const result = await postPhoneAuth('/phone-number/send-otp', {
        phoneNumber: normalizedPhone,
      });

      if (!result.success) {
        message.error(result.errorMessage || t('betterAuth.signin.phoneCodeError'));
        return;
      }

      setPhone(normalizedPhone);
      setPhoneMode('verify');
      setStep('phone');
      setPhoneCooldown(phoneAuthResendInterval);
      phoneForm.setFieldValue('phone', normalizedPhone);
      phoneForm.setFieldValue('code', '');
      message.success(t('betterAuth.signin.phoneCodeSent'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhoneCode = async (values: Pick<PhoneSignInFormValues, 'code'>) => {
    if (!phone) {
      message.error(t('betterAuth.errors.phoneRequired'));
      return;
    }

    setLoading(true);
    try {
      const result = await postPhoneAuth('/phone-number/verify', {
        code: values.code,
        phoneNumber: phone,
      });

      if (!result.success) {
        message.error(result.errorMessage || t('betterAuth.signin.phoneVerifyError'));
        return;
      }

      const callbackUrl = normalizeCallbackUrl(searchParams.get('callbackUrl') || '/');
      router.push(callbackUrl);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialSignIn = async (provider: string) => {
    setSocialLoading(provider);
    const normalizedProvider = normalizeProviderId(provider);
    try {
      if (ENABLE_BUSINESS_FEATURES && !(await preSocialSigninCheck())) {
        setSocialLoading(null);
        return;
      }

      try {
        localStorage.setItem(LAST_AUTH_PROVIDER_KEY, provider);
      } catch {
        // Ignore localStorage errors (e.g., quota exceeded, private mode)
      }

      const callbackUrl = normalizeCallbackUrl(searchParams.get('callbackUrl') || '/');
      const additionalData = await getAdditionalData();
      const result = isBuiltinProvider(normalizedProvider)
        ? await signIn.social({
            additionalData,
            callbackURL: callbackUrl,
            provider: normalizedProvider,
          })
        : await signIn.oauth2({
            additionalData,
            callbackURL: callbackUrl,
            providerId: normalizedProvider,
          });
      if (result?.error) throw result.error;
    } catch (error) {
      console.error(`${normalizedProvider} sign in error:`, error);
      message.error(t('betterAuth.signin.socialError'));
    } finally {
      setSocialLoading(null);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setEmail('');
    setIsSocialOnly(false);
    setPhone('');
    setPhoneCooldown(0);
    setPhoneMode('input');
  };

  const handleGoToSignup = () => {
    const currentEmail = form.getFieldValue('email');
    const callbackUrl = searchParams.get('callbackUrl') || '/';
    const params = new URLSearchParams();
    if (currentEmail) params.set('email', currentEmail);
    params.set('callbackUrl', callbackUrl);
    router.push(`/signup?${params.toString()}`);
  };

  const handleForgotPassword = async () => {
    try {
      await requestPasswordReset({
        email,
        redirectTo: `/reset-password?email=${encodeURIComponent(email)}`,
      });
      message.success(t('betterAuth.signin.forgotPasswordSent'));
    } catch {
      message.error(t('betterAuth.signin.forgotPasswordError'));
    }
  };

  const resolvedProviders = ENABLE_BUSINESS_FEATURES ? ssoProviders : oAuthSSOProviders;
  const sortedProviders = lastAuthProvider
    ? [...resolvedProviders].sort((a, b) => {
        if (a === lastAuthProvider) return -1;
        if (b === lastAuthProvider) return 1;
        return 0;
      })
    : resolvedProviders;

  return {
    disableEmailPassword,
    enablePhoneAuth,
    email,
    form,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToSignup,
    handleSendPhoneCode,
    handleSignIn,
    handleSocialSignIn,
    handleVerifyPhoneCode,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders: sortedProviders,
    phone,
    phoneCooldown,
    phoneForm,
    phoneMode,
    serverConfigInit: ENABLE_BUSINESS_FEATURES ? true : serverConfigInit,
    socialLoading,
    step,
  };
};
