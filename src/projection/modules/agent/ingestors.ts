import type {
  AgentAvailableIndex,
  AgentDirectoryIndex,
  AgentItem,
  AgentProjection,
  AgentQuerySignature,
  LobeAgentConfig,
  ProjectionCommit,
  ProjectionRef,
  SidebarAgentItem,
} from '@lobechat/types';
import { agentSearchIndexKey } from '@lobechat/types';

import { projectionFragment, type ProjectionObservation } from '../../core/ingest';
import { sidebarItemProjectionRecord } from '../home/ingestors';

export type AgentProjectionInput = Partial<AgentItem> &
  Partial<Omit<LobeAgentConfig, keyof AgentItem>> & {
    heteroType?: string | null;
    heterogeneousType?: string | null;
    id: string;
  };

const summaryFragments = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
): AgentProjection['fragments'] => ({
  access: projectionFragment(
    {
      userId: item.userId,
      visibility: item.visibility,
      workspaceId: item.workspaceId,
    },
    observation,
  ),
  identity: projectionFragment(
    {
      avatar: item.avatar,
      backgroundColor: item.backgroundColor,
      name: item.name,
      title: item.title,
    },
    observation,
  ),
  profile: projectionFragment(
    {
      description: item.description,
      marketIdentifier: item.marketIdentifier,
      slug: item.slug,
      tags: item.tags,
    },
    observation,
  ),
  runtime: projectionFragment(
    {
      heterogeneousType:
        item.heterogeneousType ?? item.heteroType ?? item.agencyConfig?.heterogeneousProvider?.type,
      virtual: item.virtual,
    },
    observation,
  ),
});

export const agentProjectionRecord = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
  coverage: 'full' | 'summary' = 'full',
): AgentProjection => ({
  fragments: {
    ...summaryFragments(item, observation),
    ...(coverage === 'full'
      ? {
          configuration: projectionFragment(
            {
              agencyConfig: item.agencyConfig ?? undefined,
              chatConfig: item.chatConfig ?? undefined,
              editorData: item.editorData ?? undefined,
              fewShots: item.fewShots ?? undefined,
              model: item.model ?? undefined,
              openingMessage: item.openingMessage ?? undefined,
              openingQuestions: item.openingQuestions,
              params: item.params ?? undefined,
              plugins: item.plugins,
              provider: item.provider ?? undefined,
              systemRole: item.systemRole ?? undefined,
              tts: item.tts ?? undefined,
            },
            observation,
          ),
          knowledge: projectionFragment(
            { files: item.files, knowledgeBases: item.knowledgeBases },
            observation,
          ),
          lifecycle: projectionFragment(
            { createdAt: item.createdAt, updatedAt: item.updatedAt },
            observation,
          ),
          routing: projectionFragment(
            {
              clientId: item.clientId,
              sessionGroupId: item.sessionGroupId,
            },
            observation,
          ),
        }
      : {}),
  },
  id: item.id,
  kind: 'agent',
});

const refs = (items: AgentProjectionInput[]): ProjectionRef<'agent'>[] =>
  items.map(({ id }) => ({ id, kind: 'agent' }));

export const ingestAvailableAgents = (
  items: AgentProjectionInput[],
  signature: AgentQuerySignature,
  observation: ProjectionObservation,
): ProjectionCommit => ({
  indexes: [
    {
      key: 'agent.available',
      refs: refs(items),
      signature,
      ...observation,
    } satisfies AgentAvailableIndex,
  ],
  records: items.map((item) => agentProjectionRecord(item, observation, 'summary')),
});

export const ingestAgentDirectory = (
  items: AgentProjectionInput[],
  signature: AgentQuerySignature,
  observation: ProjectionObservation,
): ProjectionCommit => ({
  indexes: [
    {
      key: 'agent.directory',
      refs: refs(items),
      signature,
      ...observation,
    } satisfies AgentDirectoryIndex,
  ],
  records: items.map((item) => agentProjectionRecord(item, observation, 'summary')),
});

export const ingestAgentSearch = (
  items: SidebarAgentItem[],
  signature: AgentQuerySignature,
  observation: ProjectionObservation,
): ProjectionCommit => ({
  indexes: [
    {
      key: agentSearchIndexKey(signature.keyword),
      refs: items.map((item) => ({
        id: item.id,
        kind: item.type === 'group' ? ('chatGroup' as const) : ('agent' as const),
        pinned: item.pinned,
        unreadCount: item.unreadCount,
        updatedAt: item.updatedAt,
      })),
      signature,
      ...observation,
    },
  ],
  records: items.map((item) => sidebarItemProjectionRecord(item, observation)),
});

export const ingestAgentConfig = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
): ProjectionCommit => ({ records: [agentProjectionRecord(item, observation)] });
