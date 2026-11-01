'use client';

import { Button, Center } from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';

import { resolveShareNotFoundCopy, type ShareNotFoundCopy } from './notFoundCopy';

export type { ShareNotFoundCopy } from './notFoundCopy';

interface ShareErrorViewProps {
  error: unknown;
  /** What a missing share is called on this page; defaults to the topic copy. */
  notFound?: ShareNotFoundCopy;
}

const ShareErrorView = memo<ShareErrorViewProps>(({ error, notFound }) => {
  const { t } = useTranslation('chat');

  const trpcError = error instanceof TRPCClientError ? error : null;
  const errorCode = trpcError?.data?.code;

  if (errorCode === 'UNAUTHORIZED') {
    return (
      <Center height={'100%'} padding={48}>
        <NotFound
          desc={t('sharePage.error.unauthorized.subtitle')}
          status={''}
          title={t('sharePage.error.unauthorized.title')}
          extra={
            <Button
              href="/signin"
              type="primary"
              onClick={(event) => {
                event.preventDefault();
                const callbackUrl = `${window.location.pathname}${window.location.search}`;
                const target = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
                void trackLoginOrSignupClicked({
                  spm: 'share.unauthorized.signin.click',
                }).finally(() => {
                  window.location.href = target;
                });
              }}
            >
              {t('sharePage.error.unauthorized.action')}
            </Button>
          }
        />
      </Center>
    );
  }

  if (errorCode === 'FORBIDDEN') {
    return (
      <Center height={'100%'} padding={48}>
        <NotFound
          desc={t('sharePage.error.forbidden.subtitle')}
          status={403}
          title={t('sharePage.error.forbidden.title')}
        />
      </Center>
    );
  }

  const copy = resolveShareNotFoundCopy(notFound, {
    desc: t('sharePage.error.notFound.subtitle'),
    title: t('sharePage.error.notFound.title'),
  });

  return (
    <Center height={'100%'} padding={48}>
      <NotFound desc={copy.desc} title={copy.title} />
    </Center>
  );
});

ShareErrorView.displayName = 'ShareErrorView';

export default ShareErrorView;
