'use client';

import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStyles } from 'antd-style';
import NextLink from 'next/link';
import { PropsWithChildren, memo, useEffect } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100vw;
    min-height: 100vh;
    background: ${token.colorBgLayout};
  `,
  content: css`
    flex: 1;
    width: 100%;
    padding-block: 24px;
    padding-inline: 24px;
  `,
  header: css`
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
}));

const ShareTopicLayout = memo<PropsWithChildren>(({ children }) => {
  const { styles } = useStyles();
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
      const meta: any = {
        avatar: data.agentMeta.avatar ?? undefined,
        backgroundColor: data.agentMeta.backgroundColor ?? undefined,
        title: data.agentMeta.title ?? undefined,
      };
      dispatchAgentMap(data.agentId, meta);
    }
  }, [data?.agentId, data?.agentMeta, dispatchAgentMap]);

  return (
    <Flexbox className={styles.container}>
      <Flexbox align="center" className={styles.header} gap={12} horizontal justify="space-between">
        {isLogin ? (
          <Link to="/">
            <ProductLogo size={36} />
          </Link>
        ) : (
          <NextLink href="/login">
            <ProductLogo size={36} />
          </NextLink>
        )}
        {data?.title && (
          <Typography.Text ellipsis strong style={{ flex: 1, textAlign: 'center' }}>
            {data.title}
          </Typography.Text>
        )}
        <div style={{ width: 36 }} />
      </Flexbox>
      <Flexbox className={styles.content}>{children ?? <Outlet />}</Flexbox>
    </Flexbox>
  );
});

export default ShareTopicLayout;
