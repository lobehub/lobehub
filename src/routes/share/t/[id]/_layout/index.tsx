'use client';

import { Alert, Center, Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import NextLink from 'next/link';
import { type PropsWithChildren } from 'react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';

import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import { useIsDark } from '@/hooks/useIsDark';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import SharePortal from '../features/Portal';
import { styles } from './style';
import Title from './Title';

const ShareTopicLayout = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();
  const isLogin = useUserStore(authSelectors.isLogin);

  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
      <Flexbox
        className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
        height={'100%'}
        width={'100%'}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          justify={'space-between'}
          padding={8}
          width={'100%'}
        >
          <Flexbox horizontal align="center" flex={1} gap={12}>
            {isLogin ? (
              <Link style={{ color: 'inherit' }} to="/">
                <ProductLogo size={32} />
              </Link>
            ) : (
              <NextLink href="/signin" style={{ color: 'inherit' }}>
                <ProductLogo size={32} />
              </NextLink>
            )}
          </Flexbox>
          <Center horizontal flex={2} gap={12}>
            <Suspense>
              <Title />
            </Suspense>
          </Center>
          <Flexbox horizontal align="center" flex={1} gap={12} justify={'flex-end'} />
        </Flexbox>
        <Flexbox horizontal className={styles.content} style={{ overflow: 'hidden' }}>
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <Suspense fallback={<Loading debugId="share layout" />}>
              {children ?? <Outlet />}
            </Suspense>
          </Flexbox>
          <SharePortal />
        </Flexbox>
        <Center padding={8} style={{ opacity: 0.25 }}>
          <Alert title={t('sharePageDisclaimer')} type={'secondary'} variant={'borderless'} />
        </Center>
      </Flexbox>
    </Flexbox>
  );
});

export default ShareTopicLayout;
