import type {
  AgentGroupDetail,
  ChatGroupItem,
  ChatGroupListIndex,
  ChatGroupProjection,
  ProjectionCommit,
} from '@lobechat/types';

import { projectionFragment, type ProjectionObservation } from '../../core/ingest';
import { agentProjectionRecord } from '../agent/ingestors';

type ChatGroupProjectionInput = Partial<ChatGroupItem> & {
  groupAvatar?: string | null;
  id: string;
};

export const chatGroupProjectionRecord = (
  item: ChatGroupProjectionInput,
  observation: ProjectionObservation,
  detail?: AgentGroupDetail,
): ChatGroupProjection => ({
  fragments: {
    access: projectionFragment(
      { userId: item.userId, visibility: item.visibility, workspaceId: item.workspaceId },
      observation,
    ),
    configuration: projectionFragment(
      {
        clientId: item.clientId,
        config: item.config,
        content: item.content,
        editorData: item.editorData,
        groupId: item.groupId,
        marketIdentifier: item.marketIdentifier,
        pinned: item.pinned,
      },
      observation,
    ),
    identity: projectionFragment(
      {
        avatar: item.avatar,
        backgroundColor: item.backgroundColor,
        description: item.description,
        groupAvatar: item.groupAvatar,
        title: item.title ?? null,
      },
      observation,
    ),
    lifecycle: projectionFragment(
      { accessedAt: item.accessedAt, createdAt: item.createdAt, updatedAt: item.updatedAt },
      observation,
    ),
    ...(detail
      ? {
          membership: projectionFragment(
            {
              agents: detail.agents.map(({ id, isSupervisor }) => ({
                id,
                isSupervisor,
                kind: 'agent' as const,
              })),
              supervisorAgentId: detail.supervisorAgentId,
            },
            observation,
          ),
        }
      : {}),
  },
  id: item.id,
  kind: 'chatGroup',
});

export const ingestChatGroups = (
  items: ChatGroupItem[],
  observation: ProjectionObservation,
): ProjectionCommit => ({
  indexes: [
    {
      key: 'chatGroup.list',
      refs: items.map(({ id }) => ({ id, kind: 'chatGroup' })),
      ...observation,
    } satisfies ChatGroupListIndex,
  ],
  records: items.map((item) => chatGroupProjectionRecord(item, observation)),
});

export const ingestChatGroupDetail = (
  item: AgentGroupDetail,
  observation: ProjectionObservation,
): ProjectionCommit => ({
  records: [
    chatGroupProjectionRecord(item, observation, item),
    ...item.agents.map((agent) => agentProjectionRecord(agent, observation)),
  ],
});
