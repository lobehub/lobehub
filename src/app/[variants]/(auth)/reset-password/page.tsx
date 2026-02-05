'use client';

import { Button } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Link from '@/libs/next/Link';
import { useRouter, useSearchParams } from '@/libs/next/navigation';

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
