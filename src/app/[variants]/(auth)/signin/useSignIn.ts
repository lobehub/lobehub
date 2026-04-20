import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Form } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CheckUserResponseData } from '@/app/(backend)/api/auth/check-user/route';
import { type ResolveUsernameResponseData } from '@/app/(backend)/api/auth/resolve-username/route';
import { useBusinessSignin } from '@/business/client/hooks/useBusinessSignin';
import { message } from '@/components/AntdStaticMethods';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { requestPasswordReset, signIn } from '@/libs/better-auth/auth-client';
import { isBuiltinProvider, normalizeProviderId } from '@/libs/better-auth/utils/client';

import { useAuthServerConfigStore } from '../_layout/AuthServerConfigProvider';
import { EMAIL_REGEX, USERNAME_REGEX } from './SignInEmailStep';

const LAST_AUTH_PROVIDER_KEY = 'lobehub:auth:last-provider:v1';

type Step = 'email' | 'password';

interface SignInFormValues {
  email: string;
  password: string;
}

interface ResolvedEmailResult {
  email: string;
  identifierType: 'email' | 'username';
}

export const useSignIn = () => {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const enableMagicLink = useAuthServerConfigStore((s) => s.serverConfig.enableMagicLink || false);
  const disableEmailPassword = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailPassword || false,
  );
  const [form] = Form.useForm<SignInFormValues>();
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
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
  const {
    businessElement,
    ssoProviders,
    preSocialSigninCheck,
    getAdditionalData,
    getFetchOptions,
  } = useBusinessSignin();

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) form.setFieldValue('email', emailParam);
  }, [searchParams, form]);

  const handleSendMagicLink = async (targetEmail?: string) => {
    try {
      const emailValue =
        targetEmail ||
        (await form
          .validateFields(['email'])
          .then((v) => v.email as string)
          .catch(() => null));
      if (!emailValue) return;

      const callbackUrl = searchParams.get('callbackUrl') || '/';
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
    await trackLoginOrSignupClicked({ spm: 'signin.password_step.submit' });

    try {
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const result = await signIn.email(
        { callbackURL: callbackUrl, email, password: values.password },
        {
          onError: (ctx) => {
            console.error('Sign in error:', ctx.error);
            if (ctx.error.status === 403) {
              router.push(
                `/verify-email?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
              );
            }
          },
          onSuccess: () => router.push(callbackUrl),
        },
      );

      if (result.error && result.error.status !== 403) {
        message.error(result.error.message || t('betterAuth.signin.error'));
      }
    } catch (error) {
      console.error('Sign in error:', error);
      message.error(t('betterAuth.signin.error'));
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
      if (ENABLE_BUSINESS_FEATURES && !(await preSocialSigninCheck())) {
        setSocialLoading(null);
        return;
      }

      try {
        localStorage.setItem(LAST_AUTH_PROVIDER_KEY, provider);
      } catch {
        // Ignore localStorage errors (e.g., quota exceeded, private mode)
      }

      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const additionalData = await getAdditionalData();
      const fetchOptions = await getFetchOptions();
      const result = isBuiltinProvider(normalizedProvider)
        ? await signIn.social({
            additionalData,
            callbackURL: callbackUrl,
            fetchOptions,
            provider: normalizedProvider,
          })
        : await signIn.oauth2({
            additionalData,
            callbackURL: callbackUrl,
            fetchOptions,
            providerId: normalizedProvider,
          });
      if (result && 'error' in result && result.error) throw result.error;
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
  };

  const handleGoToSignup = () => {
    const currentEmail = form.getFieldValue('email');
    const callbackUrl = searchParams.get('callbackUrl') || '/';
    const params = new URLSearchParams();
    if (currentEmail) params.set('email', currentEmail);
    params.set('callbackUrl', callbackUrl);
    void trackLoginOrSignupClicked({ spm: 'signin.go_to_signup.click' }).finally(() => {
      router.push(`/signup?${params.toString()}`);
    });
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
    businessElement,
    disableEmailPassword,
    email,
    form,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToSignup,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders: sortedProviders,
    serverConfigInit: ENABLE_BUSINESS_FEATURES ? true : serverConfigInit,
    socialLoading,
    step,
  };
};
