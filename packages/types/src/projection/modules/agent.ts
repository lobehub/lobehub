import type { ProjectionRef, ProjectionSource } from '../base';

export type AgentAvailableIndexKey = 'agent.available';
export type AgentDirectoryIndexKey = 'agent.directory';
export type AgentSearchIndexKey = `agent.search:${string}`;

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

export type AgentIndexMap = {
  'agent.available': AgentAvailableIndex;
  'agent.directory': AgentDirectoryIndex;
} & { [K in AgentSearchIndexKey]: AgentSearchIndex };

export const agentSearchIndexKey = (keyword = ''): AgentSearchIndexKey =>
  `agent.search:${encodeURIComponent(keyword)}`;
