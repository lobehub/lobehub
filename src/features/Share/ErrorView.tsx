'use client';

import { Center } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { TRPCClientError } from '@trpc/client';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';

interface ShareErrorViewProps {
  error: unknown;
  resource?: 'agent' | 'topic';
}

export const getShareErrorCopyKeys = (resource: 'agent' | 'topic', errorCode?: string) => {
  if (errorCode === 'UNAUTHORIZED') {
    return {
      subtitle:
        resource === 'agent'
          ? ('sharePage.error.agent.unauthorized.subtitle' as const)
          : ('sharePage.error.unauthorized.subtitle' as const),
      title: 'sharePage.error.unauthorized.title' as const,
    };
  }

  if (errorCode === 'FORBIDDEN') {
    return {
      subtitle: 'sharePage.error.forbidden.subtitle' as const,
      title: 'sharePage.error.forbidden.title' as const,
    };
  }

  return {
    subtitle:
      resource === 'agent'
        ? ('sharePage.error.agent.notFound.subtitle' as const)
        : ('sharePage.error.notFound.subtitle' as const),
    title:
      resource === 'agent'
        ? ('sharePage.error.agent.notFound.title' as const)
        : ('sharePage.error.notFound.title' as const),
  };
};

const ShareErrorView = memo<ShareErrorViewProps>(({ error, resource = 'topic' }) => {
  const { t } = useTranslation('chat');

  const trpcError = error instanceof TRPCClientError ? error : null;
  const errorCode = trpcError?.data?.code;
  const copy = getShareErrorCopyKeys(resource, errorCode);

  if (errorCode === 'UNAUTHORIZED') {
    return (
      <Center height={'100%'} padding={48}>
        <NotFound
          desc={t(copy.subtitle)}
          status={''}
          title={t(copy.title)}
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
                  // The standalone Share app uses React Router rather than the
                  // Next.js router targeted by this lint rule.
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
        <NotFound desc={t(copy.subtitle)} status={403} title={t(copy.title)} />
      </Center>
    );
  }

  return (
    <Center height={'100%'} padding={48}>
      <NotFound desc={t(copy.subtitle)} title={t(copy.title)} />
    </Center>
  );
});

ShareErrorView.displayName = 'ShareErrorView';

export default ShareErrorView;
