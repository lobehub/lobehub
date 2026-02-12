'use client';

import { Button } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Link from '@/libs/next/Link';
import { useSearchParams } from '@/libs/next/navigation';

import AuthCard from '../../../../features/AuthCard';
import { VerifyEmailContent } from './VerifyEmailContent';

const VerifyEmailPage = () => {
  const { t } = useTranslation('auth');
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  return (
    <AuthCard
      subtitle={t('betterAuth.verifyEmail.description', { email: email || '@' })}
      title={t('betterAuth.verifyEmail.title')}
      footer={
        <Link href={'/signin'}>
          <Button block icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.verifyEmail.backToSignIn')}
          </Button>
        </Link>
      }
    >
      <VerifyEmailContent callbackUrl={callbackUrl} email={email} />
    </AuthCard>
  );
};

export default VerifyEmailPage;
