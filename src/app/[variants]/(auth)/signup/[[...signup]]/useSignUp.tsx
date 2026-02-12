import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { form } from 'motion/react-m';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type BusinessSignupFomData } from '@/business/client/hooks/useBusinessSignup';
import { useBusinessSignup } from '@/business/client/hooks/useBusinessSignup';
import { message } from '@/components/AntdStaticMethods';
import { signUp } from '@/libs/better-auth/auth-client';
import { useRouter, useSearchParams } from '@/libs/next/navigation';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { type BaseSignUpFormValues } from './types';

export type SignUpFormValues = BaseSignUpFormValues & BusinessSignupFomData;

export const useSignUp = () => {
  const { t } = useTranslation(['auth', 'authError']);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const { getFetchOptions, preSocialSignupCheck, businessElement } = useBusinessSignup(form);
  const enableEmailVerification = useServerConfigStore(
    serverConfigSelectors.enableEmailVerification,
  );

  const handleSignUp = async (values: SignUpFormValues) => {
    setLoading(true);
    try {
      if (ENABLE_BUSINESS_FEATURES && !(await preSocialSignupCheck(values))) {
        setLoading(false);
        return;
      }

      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const username = values.email.split('@')[0];

      const { error } = await signUp.email({
        callbackURL: callbackUrl,
        email: values.email,
        fetchOptions: await getFetchOptions(),
        name: username,
        password: values.password,
      });

      if (error) {
        const isEmailDuplicate =
          error.code === 'FAILED_TO_CREATE_USER' &&
          (error as any)?.details?.cause?.code === '23505';

        if (isEmailDuplicate) {
          message.error(t('betterAuth.errors.emailExists'));
          return;
        }

        if (error.code === 'INVALID_EMAIL' || error.message === 'Invalid email') {
          message.error(t('betterAuth.errors.emailInvalid'));
          return;
        }

        const translated = error.code
          ? t(`authError:codes.${error.code}`, { defaultValue: '' })
          : '';
        message.error(translated || error.message || t('betterAuth.signup.error'));
        return;
      }

      if (enableEmailVerification) {
        router.push(
          `/verify-email?email=${encodeURIComponent(values.email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        );
      } else {
        router.push(callbackUrl);
      }
    } catch {
      message.error(t('betterAuth.signup.error'));
    } finally {
      setLoading(false);
    }
  };

  return { businessElement, loading, onSubmit: handleSignUp };
};
