'use client';

import { type AgentGroupDetail, type AgentGroupMember } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import PageTitle from '@/components/PageTitle';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';

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

  // Set group meta to agentGroupStore for group avatar display
  useEffect(() => {
    if (data?.groupId && data.groupMeta) {
      const members = data.groupMeta.members || [];

      // Sync each member to agentStore for subagent avatar display
      for (const member of members) {
        dispatchAgentMap(member.id, {
          avatar: member.avatar ?? undefined,
          backgroundColor: member.backgroundColor ?? undefined,
          title: member.title ?? undefined,
        });
      }

      // Build AgentGroupDetail for groupMap
      const groupDetail: AgentGroupDetail = {
        agents: members.map((m) => ({
          avatar: m.avatar,
          backgroundColor: m.backgroundColor,
          id: m.id,
          isSupervisor: false,
          title: m.title,
        })) as AgentGroupMember[],
        avatar: data.groupMeta.avatar,
        backgroundColor: data.groupMeta.backgroundColor,
        createdAt: data.groupMeta.createdAt ? new Date(data.groupMeta.createdAt) : new Date(),
        id: data.groupId,
        title: data.groupMeta.title,
        updatedAt: data.groupMeta.updatedAt ? new Date(data.groupMeta.updatedAt) : new Date(),
        userId: data.groupMeta.userId || '',
      };

      // Set activeGroupId and update groupMap
      useAgentGroupStore.setState(
        (state) => ({
          activeGroupId: data.groupId!,
          groupMap: {
            ...state.groupMap,
            [data.groupId!]: groupDetail,
          },
        }),
        false,
        'syncSharedGroupMeta',
      );
    }
  }, [data?.groupId, data?.groupMeta, dispatchAgentMap]);

  return (
    data?.title && (
      <>
        <PageTitle title={data.title} />
        <Text ellipsis strong align={'center'} fontSize={16} style={{ textAlign: 'center' }}>
          {data.title}
        </Text>
      </>
    )
  );
});

export default Title;
