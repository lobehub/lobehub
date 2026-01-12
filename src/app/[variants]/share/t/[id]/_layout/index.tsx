'use client';

import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStyles } from 'antd-style';
import Link from 'next/link';
import { PropsWithChildren, memo } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import { lambdaClient } from '@/libs/trpc/client';

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

  const { data } = useSWR(
    id ? ['shared-topic', id] : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  return (
    <Flexbox className={styles.container}>
      <Flexbox align="center" className={styles.header} gap={12} horizontal justify="space-between">
        <Link href="/">
          <ProductLogo size={36} />
        </Link>
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
