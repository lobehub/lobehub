'use client';

import { Button, Center } from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import NotFound from '@/components/404';
import Loading from '@/components/Loading/BrandTextLoading';
import { lambdaClient } from '@/libs/trpc/client';

import ActionBar from './features/ActionBar';
import SharedMessageList from './SharedMessageList';

const styles = createStaticStyles(({ css }) => ({
  errorContainer: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    height: 80vh;
    padding: 48px;

    text-align: center;
  `,
}));

const ShareTopicPage = memo(() => {
  const { t } = useTranslation('chat');
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    id ? ['shared-topic', id] : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  if (!error && isLoading) {
    return (
      <Center className={styles.errorContainer}>
        <Loading debugId="share" />
      </Center>
    );
  }

  if (error) {
    const trpcError = error instanceof TRPCClientError ? error : null;
    const errorCode = trpcError?.data?.code;

    if (errorCode === 'UNAUTHORIZED') {
      return (
        <Center className={styles.errorContainer}>
          <NotFound
            desc={t('sharePage.error.unauthorized.subtitle')}
            status={''}
            title={t('sharePage.error.unauthorized.title')}
            extra={
              <Button href="/signin" type="primary">
                {t('sharePage.error.unauthorized.action')}
              </Button>
            }
          />
        </Center>
      );
    }

    if (errorCode === 'FORBIDDEN') {
      return (
        <Center className={styles.errorContainer}>
          <NotFound
            desc={t('sharePage.error.forbidden.subtitle')}
            status={403}
            title={t('sharePage.error.forbidden.title')}
          />
        </Center>
      );
    }

    // NOT_FOUND or other errors
    return (
      <Center className={styles.errorContainer}>
        <NotFound
          desc={t('sharePage.error.notFound.subtitle')}
          title={t('sharePage.error.notFound.title')}
        />
      </Center>
    );
  }

  if (!data) return null;

  return (
    <>
      <SharedMessageList
        agentId={data.agentId}
        groupId={data.groupId}
        shareId={data.shareId}
        topicId={data.topicId}
      />
      <Center padding={8}>
        <ActionBar data={data} />
      </Center>
    </>
  );
});

export default ShareTopicPage;
