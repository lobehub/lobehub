'use client';

import { Alert, Center, Flexbox, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import NextLink from 'next/link';
import { PropsWithChildren, memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';
import { useIsDark } from '@/hooks/useIsDark';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import SharePortal from '../features/Portal';
import { styles } from './style';

const ShareTopicLayout = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();
  const { id } = useParams<{ id: string }>();
  const dispatchAgentMap = useAgentStore((s) => s.internal_dispatchAgentMap);
  const isLogin = useUserStore(authSelectors.isLogin);

  const { data } = useSWR(
    id ? ['shared-topic', id] : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  // Set agent meta to agentStore for avatar display
  useEffect(() => {
    if (data?.agentId && data.agentMeta) {
      const meta = {
        avatar: data.agentMeta.avatar ?? undefined,
        backgroundColor: data.agentMeta.backgroundColor ?? undefined,
        title: data.agentMeta.title ?? undefined,
      };
      dispatchAgentMap(data.agentId, meta);
    }
  }, [data?.agentId, data?.agentMeta, dispatchAgentMap]);

  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
      <Flexbox
        className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
        height={'100%'}
        width={'100%'}
      >
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'space-between'}
          padding={8}
          width={'100%'}
        >
          <Flexbox align="center" flex={1} gap={12} horizontal>
            {isLogin ? (
              <Link to="/">
                <UserAvatar size={32} />
              </Link>
            ) : (
              <NextLink href="/login">
                <ProductLogo size={32} />
              </NextLink>
            )}
          </Flexbox>
          <Center flex={2} gap={12} horizontal>
            {data?.title && (
              <Text align={'center'} ellipsis style={{ textAlign: 'center' }} weight={500}>
                {data.title}
              </Text>
            )}
          </Center>
          <Flexbox align="center" flex={1} gap={12} horizontal justify={'flex-end'} />
        </Flexbox>
        <Flexbox className={styles.content} horizontal style={{ overflow: 'hidden' }}>
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            {children ?? <Outlet />}
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
