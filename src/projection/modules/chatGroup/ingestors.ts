import type {
  AgentGroupDetail,
  ChatGroupItem,
  ChatGroupListIndex,
  ChatGroupProjection,
  ProjectionCommit,
} from '@lobechat/types';

import { projectionFragment, type ProjectionObservation } from '../../core/ingest';
import { type AgentProjectionCoverage, agentProjectionRecord } from '../agent/ingestors';

type ChatGroupProjectionInput = Partial<ChatGroupItem> & {
  groupAvatar?: string | null;
  id: string;
};

export type ChatGroupProjectionCoverage = 'full' | 'profile' | 'summary';

export interface ChatGroupDetailCoverage {
  group: Exclude<ChatGroupProjectionCoverage, 'summary'>;
  members: Record<string, Extract<AgentProjectionCoverage, 'full' | 'profile'>>;
}

const summaryFragments = (
  item: ChatGroupProjectionInput,
  observation: ProjectionObservation,
): ChatGroupProjection['fragments'] => ({
  access: projectionFragment(
    { userId: item.userId, visibility: item.visibility, workspaceId: item.workspaceId },
    observation,
  ),
  identity: projectionFragment(
    {
      avatar: item.avatar,
      backgroundColor: item.backgroundColor,
      description: item.description,
      title: item.title ?? null,
    },
    observation,
  ),
  lifecycle: projectionFragment(
    { accessedAt: item.accessedAt, createdAt: item.createdAt, updatedAt: item.updatedAt },
    observation,
  ),
});

const configurationFragment = (
  item: ChatGroupProjectionInput,
  observation: ProjectionObservation,
  coverage: Exclude<ChatGroupProjectionCoverage, 'summary'>,
): ChatGroupProjection['fragments'] => {
  const config =
    coverage === 'profile' && item.config
      ? {
          openingMessage: item.config.openingMessage,
          openingQuestions: item.config.openingQuestions,
        }
      : item.config;

  return {
    configuration: projectionFragment(
      {
        clientId: item.clientId,
        config,
        content: coverage === 'full' ? item.content : undefined,
        editorData: coverage === 'full' ? item.editorData : undefined,
        groupId: item.groupId,
        marketIdentifier: item.marketIdentifier,
        pinned: item.pinned,
      },
      observation,
    ),
  };
};

export const chatGroupProjectionRecord = (
  item: ChatGroupProjectionInput,
  observation: ProjectionObservation,
  coverage: ChatGroupProjectionCoverage,
  detail?: AgentGroupDetail,
): ChatGroupProjection => ({
  fragments: {
    ...summaryFragments(item, observation),
    ...(coverage === 'summary' ? {} : configurationFragment(item, observation, coverage)),
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
  records: items.map((item) => chatGroupProjectionRecord(item, observation, 'summary')),
});

export const ingestChatGroupDetail = (
  item: AgentGroupDetail,
  observation: ProjectionObservation,
  coverage: ChatGroupDetailCoverage,
): ProjectionCommit => ({
  records: [
    chatGroupProjectionRecord(item, observation, coverage.group, item),
    ...item.agents.map((agent) =>
      agentProjectionRecord(agent, observation, coverage.members[agent.id] ?? 'profile'),
    ),
  ],
});
