import type { AgentQuerySignature, ProjectionSource, SidebarAgentItem } from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt, projectionObservation } from '../../core/ingest';
import { removeEntityFromProjectionIndex } from '../../records/indexMutations';
import type { ProjectionStore } from '../../store';
import {
  type AgentProjectionCoverage,
  type AgentProjectionInput,
  ingestAgentConfig,
  ingestAgentDirectory,
  ingestAgentSearch,
  ingestAvailableAgents,
} from './ingestors';

type Setter = StoreSetter<ProjectionStore>;

export interface AgentProjectionAction {
  commitAgentConfig: (
    scope: string,
    item: AgentProjectionInput,
    coverage: AgentProjectionCoverage,
    source?: ProjectionSource,
    observedAt?: number,
  ) => void;
  commitAgentDirectory: (
    scope: string,
    items: AgentProjectionInput[],
    signature?: AgentQuerySignature,
    observedAt?: number,
  ) => void;
  commitAgentSearch: (
    scope: string,
    items: SidebarAgentItem[],
    signature: AgentQuerySignature,
    observedAt?: number,
  ) => void;
  commitAvailableAgents: (
    scope: string,
    items: AgentProjectionInput[],
    signature?: AgentQuerySignature,
    observedAt?: number,
  ) => void;
  deleteAgentProjection: (scope: string, id: string, observedAt?: number) => void;
}

class AgentProjectionActionImpl implements AgentProjectionAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  commitAgentConfig = (
    scope: string,
    item: AgentProjectionInput,
    coverage: AgentProjectionCoverage,
    source: ProjectionSource = 'network',
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestAgentConfig(item, projectionObservation(source, observedAt), coverage),
    );
  };

  commitAvailableAgents = (
    scope: string,
    items: AgentProjectionInput[],
    signature: AgentQuerySignature = {},
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestAvailableAgents(items, signature, projectionObservation('network', observedAt)),
    );
  };

  commitAgentDirectory = (
    scope: string,
    items: AgentProjectionInput[],
    signature: AgentQuerySignature = {},
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestAgentDirectory(items, signature, projectionObservation('network', observedAt)),
    );
  };

  commitAgentSearch = (
    scope: string,
    items: SidebarAgentItem[],
    signature: AgentQuerySignature,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestAgentSearch(items, signature, projectionObservation('network', observedAt)),
    );
  };

  deleteAgentProjection = (
    scope: string,
    id: string,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    const projectionScope = this.#get().scopes[scope];
    const topicIds = new Set(
      Object.values(projectionScope?.records.topic ?? {})
        .filter((record) => record.fragments.routing?.data.agentId === id)
        .map((record) => record.id),
    );
    const agentIds = new Set([id]);
    const indexes = Object.values(projectionScope?.indexes ?? {}).flatMap((index) => {
      if (!index) return [];
      const withoutAgent = removeEntityFromProjectionIndex(index, 'agent', agentIds, observedAt);
      const withoutTopics = removeEntityFromProjectionIndex(
        withoutAgent ?? index,
        'topic',
        topicIds,
        observedAt,
      );
      const next = withoutTopics ?? withoutAgent;
      return next ? [next] : [];
    });
    this.#get().internal_commitProjection(scope, {
      indexes,
      tombstones: [
        { id, kind: 'agent', observedAt },
        ...Array.from(topicIds, (topicId) => ({
          id: topicId,
          kind: 'topic' as const,
          observedAt,
        })),
      ],
    });
  };
}

export const createAgentProjectionAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new AgentProjectionActionImpl(set, get, api);
