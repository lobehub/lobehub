'use client';

import { type PropsWithChildren } from 'react';
import { memo, Suspense } from 'react';
import { Outlet, useParams } from 'react-router';
import useSWR from 'swr';

import ShareShell from '@/business/client/features/ShareShell';
import Loading from '@/components/Loading/BrandTextLoading';
import { RouteMetaBridge } from '@/features/RouteMeta';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import SharePortal from '../features/Portal';
import TopicAvatar from '../features/TopicAvatar';
import { useSyncSharedTopicMeta } from '../useSyncSharedTopicMeta';

const ShareTopicLayout = memo<PropsWithChildren>(({ children }) => {
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    id ? shareKeys.topic(id) : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  useSyncSharedTopicMeta(data);

  const marketIdentifier = data?.agentMeta?.marketIdentifier;
  const openUrl = marketIdentifier ? `/community/agent/${marketIdentifier}` : '/community/agent';

  return (
    <>
      <RouteMetaBridge />
      <ShareShell
        aside={<SharePortal />}
        error={error}
        loading={!error && isLoading}
        share={{ avatar: data ? <TopicAvatar data={data} /> : undefined, openUrl }}
        title={data?.title}
      >
        <Suspense fallback={<Loading debugId="share layout" />}>{children ?? <Outlet />}</Suspense>
      </ShareShell>
    </>
  );
});

export default ShareTopicLayout;
