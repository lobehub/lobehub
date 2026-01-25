'use client';

import { Text } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import PageTitle from '@/components/PageTitle';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';

const Title = memo(() => {
  const { id } = useParams<{ id: string }>();
  const dispatchAgentMap = useAgentStore((s) => s.internal_dispatchAgentMap);

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
    data?.title && (
      <>
        <PageTitle title={data.title} />
        <Text align={'center'} ellipsis fontSize={16} strong style={{ textAlign: 'center' }}>
          {data.title}
        </Text>
      </>
    )
  );
});

export default Title;
