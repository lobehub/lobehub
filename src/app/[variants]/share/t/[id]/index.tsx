'use client';

import { Flexbox } from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { Button, Result, Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import SharedMessageList from './SharedMessageList';

const useStyles = createStyles(({ css }) => ({
  container: css`
    flex: 1;
  `,
  errorContainer: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    min-height: 400px;
    padding: 48px;

    text-align: center;
  `,
}));

const ShareTopicPage = memo(() => {
  const { styles } = useStyles();
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
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

  if (error) {
    const trpcError = error instanceof TRPCClientError ? error : null;
    const errorCode = trpcError?.data?.code;

    if (errorCode === 'UNAUTHORIZED') {
      return (
        <Flexbox className={styles.errorContainer}>
          <Result
            extra={
              <Button href="/login" type="primary">
                Sign In
              </Button>
            }
            status="403"
            subTitle="Please sign in to view this shared topic."
            title="Sign In Required"
          />
        </Flexbox>
      );
    }

    if (errorCode === 'FORBIDDEN') {
      return (
        <Flexbox className={styles.errorContainer}>
          <Result
            status="403"
            subTitle="This share is private and not accessible."
            title="Access Denied"
          />
        </Flexbox>
      );
    }

    // NOT_FOUND or other errors
    return (
      <Flexbox className={styles.errorContainer}>
        <Result
          status="404"
          subTitle="This topic does not exist or has been removed."
          title="Topic Not Found"
        />
      </Flexbox>
    );
  }

  if (!data) return null;

  return (
    <Flexbox className={styles.container}>
      <SharedMessageList
        agentId={data.agentId}
        groupId={data.groupId}
        shareId={data.shareId}
        topicId={data.topicId}
      />
    </Flexbox>
  );
});

export default ShareTopicPage;
