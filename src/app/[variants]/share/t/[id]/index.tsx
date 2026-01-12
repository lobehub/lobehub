'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import WideScreenContainer from '@/features/WideScreenContainer';
import { lambdaClient } from '@/libs/trpc/client';

import SharedMessageList from './SharedMessageList';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    flex: 1;
    width: 100vw;
  `,
  notFound: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    min-height: 400px;
    padding: 48px;

    text-align: center;
  `,
  title: css`
    margin-block-end: 24px;
    padding-block-end: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
    text-align: center;
  `,
}));

const ShareTopicPage = memo(() => {
  const { styles } = useStyles();
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useSWR(
    id ? ['shared-topic', id] : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </Flexbox>
    );
  }

  if (!data) {
    return (
      <Flexbox className={styles.notFound}>
        <Typography.Title level={3}>Topic Not Found</Typography.Title>
        <Typography.Text type="secondary">
          This topic does not exist or is not publicly shared.
        </Typography.Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.container} gap={16}>
      {data.title && (
        <WideScreenContainer>
          <Typography.Title className={styles.title} level={3}>
            {data.title}
          </Typography.Title>
        </WideScreenContainer>
      )}
      <SharedMessageList agentId={data.agentId} shareId={data.shareId} topicId={data.topicId} />
    </Flexbox>
  );
});

export default ShareTopicPage;
