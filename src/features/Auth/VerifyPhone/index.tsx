'use client';

import { Button } from '@lobehub/ui/base-ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import AuthCard from '@/features/AuthCard';
import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

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
        <Link to={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
          <Button block icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.verifyPhone.backToSignIn')}
          </Button>
        </Link>
      }
    >
      <VerifyPhoneContent callbackUrl={callbackUrl} />
    </AuthCard>
  );
};

export default VerifyPhonePage;
