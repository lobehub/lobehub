import { useForm } from '@lobehub/ui/form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { BusinessSignupFomData } from '@/business/client/hooks/useBusinessSignup';
import { useBusinessSignup } from '@/business/client/hooks/useBusinessSignup';
import type { AuthFetchOptions } from '@/features/Auth/utils/authFetchOptions';
import { withCaptchaToken } from '@/features/Auth/utils/authFetchOptions';
import { useAuthAgreement } from '@/features/AuthShell/AuthAgreement';
import { useAuthServerConfigStore } from '@/features/AuthShell/AuthServerConfigProvider';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { signUp } from '@/libs/better-auth/auth-client';
import { buildOnboardingRedirectUrl, toAbsoluteAuthCallbackUrl } from '@/utils/onboardingRedirect';

import { resolveSignUpError, type SignUpErrorLike } from './resolveSignUpError';
import type { BaseSignUpFormValues } from './types';

export type SignUpFormValues = BaseSignUpFormValues & BusinessSignupFomData;

export const useSignUp = () => {
  const { t } = useTranslation(['auth', 'authError']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { agreementChecked, continueWithAgreement, setAgreementChecked } = useAuthAgreement();
  /**
   * Sign-up failure that is not tied to one field. Rendered next to the submit button
   * instead of a corner toast, and cleared as soon as the user changes any input.
   */
  const [formError, setFormError] = useState('');
  const form = useForm<SignUpFormValues>({
    initialValues: { confirmPassword: '', email: '', password: '' },
    onValuesChange: () => setFormError(''),
    onSubmit: (values) =>
      continueWithAgreement(() => {
        void handleSignUp(values);
      }),
  });
  const [loading, setLoading] = useState(false);
  const { getCaptchaTokenOnError, getFetchOptions, preSocialSignupCheck, businessElement } =
    useBusinessSignup(form);
  const enableEmailVerification = useAuthServerConfigStore(
    (s) => s.serverConfig.enableEmailVerification || false,
  );
  const enableBusinessFeatures = useAuthServerConfigStore(
    (s) => s.serverConfig.enableBusinessFeatures || false,
  );

  const handleSignUp = async (values: SignUpFormValues) => {
    setLoading(true);
    setFormError('');
    await trackLoginOrSignupClicked({ spm: 'signup.submit.click' });

    try {
      if (enableBusinessFeatures && !(await preSocialSignupCheck(values))) {
        setLoading(false);
        return;
      }

      const callbackUrl = searchParams.get('callbackUrl') || '/';
      // New users always go through onboarding first; the original target is
      // threaded via the `callbackUrl` query param and restored on finish.
      const redirectUrl = buildOnboardingRedirectUrl(callbackUrl);
      const username = values.email.split('@')[0];
      const fetchOptions = await getFetchOptions();

      const submit = async (nextFetchOptions?: AuthFetchOptions) =>
        signUp.email({
          callbackURL: toAbsoluteAuthCallbackUrl(redirectUrl, window.location.origin),
          email: values.email,
          fetchOptions: nextFetchOptions,
          name: username,
          password: values.password,
        });

      let { error } = await submit(fetchOptions);

      if (error) {
        const captchaToken = await getCaptchaTokenOnError(error);
        if (captchaToken === null) return;
        if (captchaToken) {
          ({ error } = await submit(withCaptchaToken(fetchOptions, captchaToken)));
        }
      }

      if (error) {
        const { field, message } = resolveSignUpError(error as SignUpErrorLike, t);
        if (field) form.setErrors({ [field]: message });
        else setFormError(message);
        return;
      }

      if (enableEmailVerification) {
        navigate(
          `/verify-email?email=${encodeURIComponent(values.email)}&callbackUrl=${encodeURIComponent(redirectUrl)}`,
        );
      } else {
        // onboarding lives in the main app, outside this auth SPA — full page load required
        window.location.href = redirectUrl;
      }
    } catch (error) {
      console.error('Sign up error:', error);
      setFormError(t('betterAuth.errors.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  return {
    agreementChecked,
    businessElement,
    form,
    formError,
    loading,
    onSubmit: handleSignUp,
    setAgreementChecked,
  };
};
