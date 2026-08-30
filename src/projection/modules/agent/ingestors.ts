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

export type AgentProjectionCoverage = 'full' | 'identity' | 'profile' | 'summary';

const identityFragment = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
): AgentProjection['fragments'] => ({
  identity: projectionFragment(
    {
      avatar: item.avatar,
      backgroundColor: item.backgroundColor,
      name: item.name,
      title: item.title,
    },
    observation,
  ),
});

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
  ...identityFragment(item, observation),
  profile: projectionFragment(
    {
      description: item.description,
      slug: item.slug,
    },
    observation,
  ),
  runtime: projectionFragment(
    {
      heterogeneousType:
        item.heterogeneousType ?? item.heteroType ?? item.agencyConfig?.heterogeneousProvider?.type,
    },
    observation,
  ),
});

const fullFragments = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
): AgentProjection['fragments'] => ({
  configuration: projectionFragment(
    {
      agencyConfig: item.agencyConfig ?? undefined,
      chatConfig: item.chatConfig ?? undefined,
      clientId: item.clientId,
      editorData: item.editorData ?? undefined,
      fewShots: item.fewShots ?? undefined,
      model: item.model ?? undefined,
      openingMessage: item.openingMessage ?? undefined,
      openingQuestions: item.openingQuestions,
      params: item.params ?? undefined,
      plugins: item.plugins,
      provider: item.provider ?? undefined,
      sessionGroupId: item.sessionGroupId,
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
  metadata: projectionFragment(
    {
      marketIdentifier: item.marketIdentifier,
      tags: item.tags,
      virtual: item.virtual,
    },
    observation,
  ),
});

const profileFragments = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
): AgentProjection['fragments'] => {
  const agencyConfig = item.agencyConfig
    ? {
        executionTarget: item.agencyConfig.executionTarget,
        executionTargetSelectionPolicy: item.agencyConfig.executionTargetSelectionPolicy,
        ...(item.agencyConfig.heterogeneousProvider?.type
          ? {
              heterogeneousProvider: {
                type: item.agencyConfig.heterogeneousProvider.type,
              },
            }
          : {}),
        modelSelectionPolicy: item.agencyConfig.modelSelectionPolicy,
      }
    : undefined;
  const chatConfig =
    item.chatConfig?.enableAgentMode === undefined
      ? undefined
      : { enableAgentMode: item.chatConfig.enableAgentMode };

  return {
    configuration: projectionFragment(
      {
        agencyConfig,
        chatConfig,
        model: item.model ?? undefined,
        openingMessage: item.openingMessage ?? undefined,
        openingQuestions: item.openingQuestions,
        provider: item.provider ?? undefined,
      },
      observation,
    ),
    knowledge: projectionFragment({ files: undefined, knowledgeBases: undefined }, observation),
    lifecycle: projectionFragment(
      { createdAt: item.createdAt, updatedAt: item.updatedAt },
      observation,
    ),
    metadata: projectionFragment(
      {
        marketIdentifier: item.marketIdentifier,
        tags: undefined,
        virtual: item.virtual,
      },
      observation,
    ),
  };
};

export const agentProjectionRecord = (
  item: AgentProjectionInput,
  observation: ProjectionObservation,
  coverage: AgentProjectionCoverage,
): AgentProjection => ({
  fragments: {
    ...(coverage === 'identity'
      ? identityFragment(item, observation)
      : summaryFragments(item, observation)),
    ...(coverage === 'full' ? fullFragments(item, observation) : {}),
    ...(coverage === 'profile' ? profileFragments(item, observation) : {}),
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
  coverage: AgentProjectionCoverage,
): ProjectionCommit => ({ records: [agentProjectionRecord(item, observation, coverage)] });
