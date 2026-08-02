import { toast } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { CheckUserResponseData } from '@/app/(backend)/api/auth/check-user/route';
import type { ResolveUsernameResponseData } from '@/app/(backend)/api/auth/resolve-username/route';
import { useBusinessSignin } from '@/business/client/hooks/useBusinessSignin';
import { useAuthServerConfigStore } from '@/features/AuthShell';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import {
  phoneNumber as phoneNumberApi,
  requestPasswordReset,
  signIn,
} from '@/libs/better-auth/auth-client';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { isBuiltinProvider, normalizeProviderId } from '@/libs/better-auth/utils/client';
import { buildOnboardingRedirectUrl, sanitizeRedirectPath } from '@/utils/onboardingRedirect';

import { EMAIL_REGEX, USERNAME_REGEX } from './SignInEmailStep';

const LAST_AUTH_PROVIDER_KEY = 'lobehub:auth:last-provider:v1';

type Step = 'email' | 'password' | 'emailSent' | 'phone' | 'phoneOtp';

type SentEmailType = 'magicLink' | 'resetPassword';

interface SentEmailInfo {
  email: string;
  type: SentEmailType;
}

interface SignInFormValues {
  email: string;
  password: string;
}

interface ResolvedEmailResult {
  email: string;
  identifierType: 'email' | 'username';
}

const mapPhoneOtpError = (
  code: string | undefined,
  fallback: string,
  t: (key: string) => string,
) => {
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

export const useSignIn = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const enableMagicLink = useAuthServerConfigStore((s) => s.serverConfig.enableMagicLink || false);
  const disableEmailPassword = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailPassword || false,
  );
  const enableBusinessFeatures = useAuthServerConfigStore(
    (s) => s.serverConfig.enableBusinessFeatures || false,
  );
  const [form] = Form.useForm<SignInFormValues>();
  const [phoneForm] = Form.useForm<{ phoneNumber: string }>();
  const [otpForm] = Form.useForm<{ code: string }>();
  const [loading, setLoading] = useState(false);
  // Locks the email-dispatch actions (magic link / password reset / resend) so a
  // slow network can't be double-clicked into multiple emails.
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(() =>
    searchParams.get('mode') === 'phone' ? 'phone' : 'email',
  );
  const [email, setEmail] = useState('');
  const [phoneE164, setPhoneE164] = useState('');
  const [sentInfo, setSentInfo] = useState<SentEmailInfo | null>(null);
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
  const { getAdditionalData, preSocialSigninCheck, ssoProviders } = useBusinessSignin();

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) form.setFieldValue('email', emailParam);
  }, [searchParams, form]);

  useEffect(() => {
    if (searchParams.get('mode') === 'phone') setStep('phone');
  }, [searchParams]);

  const handleSendMagicLink = async (targetEmail?: string): Promise<boolean> => {
    if (sending) return false;
    try {
      const emailValue =
        targetEmail ||
        (await form
          .validateFields(['email'])
          .then((v) => v.email as string)
          .catch(() => null));
      if (!emailValue) return false;

      setSending(true);
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const { error } = await signIn.magicLink({
        callbackURL: callbackUrl,
        email: emailValue,
        // First-time magic-link users land on onboarding first
        newUserCallbackURL: buildOnboardingRedirectUrl(callbackUrl),
      });
      if (error) {
        toast.error(error.message || t('betterAuth.signin.magicLinkError'));
        return false;
      }
      // Success is a forward step, not a fleeting toast: land on a persistent
      // "check your inbox" screen (ux Act §3.5).
      setSentInfo({ email: emailValue, type: 'magicLink' });
      setStep('emailSent');
      return true;
    } catch (error) {
      if (!(error as any)?.errorFields) {
        console.error('Magic link error:', error);
        toast.error(t('betterAuth.signin.magicLinkError'));
      }
      return false;
    } finally {
      setSending(false);
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
      toast.error(t('betterAuth.errors.emailInvalid'));
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
        toast.error(t('betterAuth.errors.usernameNotRegistered'));
        return null;
      }
      return { email: data.email, identifierType: 'username' };
    } catch (error) {
      console.error('Error resolving username:', error);
      toast.error(t('betterAuth.signin.error'));
      return null;
    }
  };

  const handleCheckUser = async (values: Pick<SignInFormValues, 'email'>) => {
    setLoading(true);
    await trackLoginOrSignupClicked({ spm: 'signin.email_step.submit' });

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
          toast.error(t('betterAuth.errors.usernameNotRegistered'));
          return;
        }
        const callbackUrl = searchParams.get('callbackUrl') || '/';
        const signupParams = new URLSearchParams();
        signupParams.set('email', targetEmail);
        signupParams.set('callbackUrl', callbackUrl);
        const utmSource = searchParams.get('utm_source');
        if (utmSource) signupParams.set('utm_source', utmSource);
        const referral = searchParams.get('referral');
        if (referral) signupParams.set('referral', referral);
        navigate(`/signup?${signupParams.toString()}`);
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
      toast.error(t('betterAuth.signin.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (values: Pick<SignInFormValues, 'password'>) => {
    setLoading(true);
    await trackLoginOrSignupClicked({ spm: 'signin.password_step.submit' });

    try {
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const result = await signIn.email(
        { callbackURL: callbackUrl, email, password: values.password },
        {
          onError: (ctx) => {
            console.error('Sign in error:', ctx.error);
            if (ctx.error.status === 403) {
              navigate(
                `/verify-email?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
              );
            }
          },
          // callbackUrl targets the main app, outside this auth SPA — full page load required
          onSuccess: () => {
            window.location.href = sanitizeRedirectPath(callbackUrl);
          },
        },
      );

      if (result.error && result.error.status !== 403) {
        // Wrong password is the most common sign-in failure. Keep the error
        // pinned inline on the field (persistent, with retry context) rather
        // than a toast that vanishes in 3s (ux Read §1.1 / Same-Page Error).
        form.setFields([
          {
            errors: [result.error.message || t('betterAuth.signin.error')],
            name: 'password',
          },
        ]);
      }
    } catch (error) {
      console.error('Sign in error:', error);
      toast.error(t('betterAuth.signin.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSocialSignIn = async (provider: string) => {
    setSocialLoading(provider);
    const normalizedProvider = normalizeProviderId(provider);
    await trackLoginOrSignupClicked({
      provider: normalizedProvider,
      spm: 'signin.social.click',
    });

    try {
      if (enableBusinessFeatures && !(await preSocialSigninCheck())) {
        setSocialLoading(null);
        return;
      }

      try {
        localStorage.setItem(LAST_AUTH_PROVIDER_KEY, provider);
      } catch {
        // Ignore localStorage errors (e.g., quota exceeded, private mode)
      }

      const callbackUrl = searchParams.get('callbackUrl') || '/';
      // First-time OAuth users land on onboarding first (phone verify is only for trial)
      const newUserCallbackURL = buildOnboardingRedirectUrl(callbackUrl);
      const additionalData = await getAdditionalData();
      const signInWithAdditionalData = async () =>
        isBuiltinProvider(normalizedProvider)
          ? await signIn.social({
              additionalData,
              callbackURL: callbackUrl,
              newUserCallbackURL,
              provider: normalizedProvider,
            })
          : await signIn.oauth2({
              additionalData,
              callbackURL: callbackUrl,
              newUserCallbackURL,
              providerId: normalizedProvider,
            });

      const result = await signInWithAdditionalData();

      if (result && 'error' in result && result.error) throw result.error;
    } catch (error) {
      console.error(`${normalizedProvider} sign in error:`, error);
      toast.error(t('betterAuth.signin.socialError'));
    } finally {
      setSocialLoading(null);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setEmail('');
    setPhoneE164('');
    setIsSocialOnly(false);
    otpForm.resetFields();
    phoneForm.resetFields();
    // Drop the previous account's password + any inline error. The form
    // instance is shared across steps and defaults to preserve, so without this
    // the next email's password step remounts pre-filled with the stale value.
    form.resetFields(['password']);
  };

  const handleGoToPhone = () => {
    setStep('phone');
    setPhoneE164('');
    otpForm.resetFields();
  };

  const sendPhoneOtp = async (rawPhone: string): Promise<boolean> => {
    const normalized = normalizeIranianPhoneNumber(rawPhone);
    if (!normalized) {
      toast.error(t('betterAuth.verifyPhone.phone.invalid'));
      return false;
    }

    const { error } = await phoneNumberApi.sendOtp({ phoneNumber: normalized });
    if (error) {
      toast.error(mapPhoneOtpError(error.code, error.message || '', t));
      return false;
    }

    setPhoneE164(normalized);
    setStep('phoneOtp');
    return true;
  };

  const handleSendPhoneOtp = async (values: { phoneNumber: string }) => {
    setLoading(true);
    await trackLoginOrSignupClicked({ spm: 'signin.phone.send_otp.click' });
    try {
      await sendPhoneOtp(values.phoneNumber);
    } finally {
      setLoading(false);
    }
  };

  const handleResendPhoneOtp = async () => {
    if (!phoneE164 || resending) return;
    setResending(true);
    try {
      const ok = await sendPhoneOtp(phoneE164);
      if (ok) toast.success(t('betterAuth.verifyPhone.otp.resent'));
    } finally {
      setResending(false);
    }
  };

  const handleVerifyPhoneOtp = async (values: { code: string }) => {
    if (!phoneE164) return;
    setLoading(true);
    await trackLoginOrSignupClicked({ spm: 'signin.phone.verify_otp.click' });
    try {
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const { error } = await phoneNumberApi.verify({
        code: values.code,
        phoneNumber: phoneE164,
      });

      if (error) {
        toast.error(mapPhoneOtpError(error.code, error.message || '', t));
        return;
      }

      try {
        localStorage.setItem(LAST_AUTH_PROVIDER_KEY, 'phone');
      } catch {
        // Ignore localStorage errors
      }

      // Phone OTP is both sign-in and sign-up. Always land on onboarding first so
      // new users never flash the chat home; finished users are bounced home by
      // useUserStateRedirect once user state loads.
      window.location.href = buildOnboardingRedirectUrl(callbackUrl);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToSignup = () => {
    const currentEmail = form.getFieldValue('email');
    const callbackUrl = searchParams.get('callbackUrl') || '/';
    const params = new URLSearchParams();
    if (currentEmail) params.set('email', currentEmail);
    params.set('callbackUrl', callbackUrl);
    const utmSource = searchParams.get('utm_source');
    if (utmSource) params.set('utm_source', utmSource);
    const referral = searchParams.get('referral');
    if (referral) params.set('referral', referral);
    void trackLoginOrSignupClicked({ spm: 'signin.go_to_signup.click' }).finally(() => {
      navigate(`/signup?${params.toString()}`);
    });
  };

  // Fire the password-reset email. Returns true on success. Shared by the
  // "forgot password" entry and the resend action on the sent screen.
  const dispatchPasswordReset = async (targetEmail: string): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    try {
      await requestPasswordReset({
        email: targetEmail,
        redirectTo: `/reset-password?email=${encodeURIComponent(targetEmail)}`,
      });
      return true;
    } catch {
      toast.error(t('betterAuth.signin.forgotPasswordError'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email || sending) return;
    const ok = await dispatchPasswordReset(email);
    if (!ok) return;
    setSentInfo({ email, type: 'resetPassword' });
    setStep('emailSent');
  };

  const handleResendEmail = async () => {
    if (!sentInfo || sending) return;
    const ok =
      sentInfo.type === 'magicLink'
        ? await handleSendMagicLink(sentInfo.email)
        : await dispatchPasswordReset(sentInfo.email);
    if (ok) toast.success(t('betterAuth.signin.emailSent.resent'));
  };

  // "Use a different email" — always drop back to the email entry so the label
  // matches the action (returning to the password step would keep the same email).
  const handleBackFromSent = () => {
    setSentInfo(null);
    handleBackToEmail();
  };

  const resolvedProviders = enableBusinessFeatures ? ssoProviders : oAuthSSOProviders;
  const sortedProviders = lastAuthProvider
    ? [...resolvedProviders].sort((a, b) => {
        if (a === lastAuthProvider) return -1;
        if (b === lastAuthProvider) return 1;
        return 0;
      })
    : resolvedProviders;

  return {
    disableEmailPassword,
    email,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToPhone,
    handleGoToSignup,
    handleResendEmail,
    handleResendPhoneOtp,
    handleSendPhoneOtp,
    handleSignIn,
    handleSocialSignIn,
    handleVerifyPhoneOtp,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders: sortedProviders,
    otpForm,
    phoneDisplay: phoneE164,
    phoneForm,
    resending,
    sending,
    sentInfo,
    serverConfigInit: enableBusinessFeatures ? true : serverConfigInit,
    socialLoading,
    step,
  };
};
