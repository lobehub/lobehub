'use client';

import { Button } from '@lobehub/ui/base-ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AuthCard from '@/features/AuthCard';
import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

import { exitVerifyPhoneFlow } from './useVerifyPhone';
import { VerifyPhoneContent } from './VerifyPhoneContent';

const VerifyPhonePage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const callbackUrl = sanitizeRedirectPath(searchParams.get('callbackUrl'), '/');

  return (
    <AuthCard
      subtitle={t('betterAuth.verifyPhone.description')}
      title={t('betterAuth.verifyPhone.title')}
      footer={
        <Button
          block
          icon={ChevronLeftIcon}
          size="large"
          onClick={() => exitVerifyPhoneFlow(callbackUrl)}
        >
          {t('betterAuth.verifyPhone.back')}
        </Button>
      }
    >
      <VerifyPhoneContent callbackUrl={callbackUrl} />
    </AuthCard>
  );
};

export default VerifyPhonePage;
