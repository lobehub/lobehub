'use client';

import { Button } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import AuthCard from '../../../../features/AuthCard';
import { ResetPasswordContent } from './ResetPasswordContent';

const ResetPasswordPage = () => {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');

  return (
    <AuthCard
      subtitle={t('betterAuth.resetPassword.description')}
      title={t('betterAuth.resetPassword.title')}
      footer={
        <Link href={'/signin'}>
          <Button block icon={ChevronLeftIcon} size={'large'}>
            {t('betterAuth.resetPassword.backToSignIn')}
          </Button>
        </Link>
      }
    >
      <ResetPasswordContent
        email={email}
        token={token}
        onSuccessRedirect={(url) => router.push(url)}
      />
    </AuthCard>
  );
};

export default ResetPasswordPage;
