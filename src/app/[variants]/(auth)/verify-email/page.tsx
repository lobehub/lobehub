'use client';

import { Button } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import AuthCard from '../../../../features/AuthCard';
import { VerifyEmailContent } from './VerifyEmailContent';

const VerifyEmailPage = () => {
  const { t } = useTranslation('auth');
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  return (
    <AuthCard
      footer={
        <Link href={'/signin'}>
          <Button block icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.verifyEmail.backToSignIn')}
          </Button>
        </Link>
      }
      subtitle={t('betterAuth.verifyEmail.description', { email: email || '@' })}
      title={t('betterAuth.verifyEmail.title')}
    >
      <VerifyEmailContent callbackUrl={callbackUrl} email={email} />
    </AuthCard>
  );
};

export default VerifyEmailPage;
