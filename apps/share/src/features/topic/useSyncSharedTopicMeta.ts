import { type AgentGroupDetail, type AgentGroupMember } from '@lobechat/types';
import { useEffect } from 'react';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState } from '@/projection';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { type SharedTopicData } from '@/types/topic';

export const useSyncSharedTopicMeta = (data: SharedTopicData | undefined) => {
  const dispatchAgentProjection = useAgentStore((s) => s.internal_dispatchAgentProjection);

  useEffect(() => {
    if (data?.agentId && data.agentMeta) {
      dispatchAgentProjection(data.agentId, {
        avatar: data.agentMeta.avatar ?? undefined,
        backgroundColor: data.agentMeta.backgroundColor ?? undefined,
        title: data.agentMeta.title ?? undefined,
      });
    }
  }, [data?.agentId, data?.agentMeta, dispatchAgentProjection]);

  useEffect(() => {
    if (!data?.groupId || !data.groupMeta) return;

    const members = data.groupMeta.members || [];

    for (const member of members) {
      dispatchAgentProjection(member.id, {
        avatar: member.avatar ?? undefined,
        backgroundColor: member.backgroundColor ?? undefined,
        title: member.title ?? undefined,
      });
    }

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

    getProjectionStoreState().commitChatGroupDetail(
      getCacheScope(),
      groupDetail,
      {
        group: 'profile',
        members: Object.fromEntries(members.map((member) => [member.id, 'profile'])),
      },
      'network',
    );
    useAgentGroupStore.setState({ activeGroupId: data.groupId }, false, 'syncSharedGroupMeta');
  }, [data?.groupId, data?.groupMeta, dispatchAgentProjection]);
};
