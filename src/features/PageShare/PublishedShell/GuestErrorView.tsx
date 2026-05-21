'use client';

import { Button, Center } from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';

interface GuestErrorViewProps {
  error: unknown;
}

const GuestErrorView: FC<GuestErrorViewProps> = ({ error }) => {
  const { t } = useTranslation('pageShare');

  const trpcError = error instanceof TRPCClientError ? error : null;
  const code = trpcError?.data?.code;

  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
    return (
      <Center padding={48}>
        <NotFound
          desc={t('error.private.desc')}
          status={403}
          title={t('error.private.title')}
          extra={
            <Button
              href="/signin"
              type="primary"
              onClick={(event) => {
                event.preventDefault();
                const callbackUrl = `${window.location.pathname}${window.location.search}`;
                void trackLoginOrSignupClicked({
                  spm: 'pageShare.private.signin.click',
                }).finally(() => {
                  window.location.href = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
                });
              }}
            >
              {t('error.private.action')}
            </Button>
          }
        />
      </Center>
    );
  }

  return (
    <Center padding={48}>
      <NotFound desc={t('error.notFound.desc')} title={t('error.notFound.title')} />
    </Center>
  );
};

export default GuestErrorView;
