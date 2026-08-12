import type { ProjectionRef, ProjectionSource } from '../base';
import type { ProjectionKeyOf } from '../runtime';
import { defineProjectionKeySpace } from '../runtime';

export const AGENT_SEARCH_INDEX_PREFIX = 'agent.search:';
export const AGENT_INDEX_KEYS = {
  available: 'agent.available',
  directory: 'agent.directory',
} as const;

export const agentIndexKeySpace = defineProjectionKeySpace({
  patterns: [{ allowEmptySuffix: true, prefix: AGENT_SEARCH_INDEX_PREFIX }],
  staticKeys: Object.values(AGENT_INDEX_KEYS),
});

type AgentIndexKey = ProjectionKeyOf<typeof agentIndexKeySpace>;
export type AgentAvailableIndexKey = typeof AGENT_INDEX_KEYS.available;
export type AgentDirectoryIndexKey = typeof AGENT_INDEX_KEYS.directory;
export type AgentSearchIndexKey = Extract<
  AgentIndexKey,
  `${typeof AGENT_SEARCH_INDEX_PREFIX}${string}`
>;

export interface AgentQuerySignature {
  keyword?: string;
  limit?: number;
  offset?: number;
}

interface AgentListIndexBase<K extends string, R extends ProjectionRef> {
  key: K;
  observedAt: number;
  refs: R[];
  signature: AgentQuerySignature;
  source: ProjectionSource;
}

export interface AgentAvailableIndex extends AgentListIndexBase<
  AgentAvailableIndexKey,
  ProjectionRef<'agent'>
> {}

export interface AgentDirectoryIndex extends AgentListIndexBase<
  AgentDirectoryIndexKey,
  ProjectionRef<'agent'>
> {}

export type AgentSearchProjectionRef = ProjectionRef<'agent' | 'chatGroup'> & {
  pinned: boolean;
  unreadCount?: number;
  updatedAt: Date;
};

export interface AgentSearchIndex extends AgentListIndexBase<
  AgentSearchIndexKey,
  AgentSearchProjectionRef
> {}

export type AgentIndexMap = { [K in AgentAvailableIndexKey]: AgentAvailableIndex } & {
  [K in AgentDirectoryIndexKey]: AgentDirectoryIndex;
} & { [K in AgentSearchIndexKey]: AgentSearchIndex };

export const agentSearchIndexKey = (keyword = ''): AgentSearchIndexKey =>
  `${AGENT_SEARCH_INDEX_PREFIX}${encodeURIComponent(keyword)}`;
