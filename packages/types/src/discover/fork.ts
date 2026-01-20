/**
 * Fork-related types for agents and agent groups
 */

/**
 * Fork request parameters for Agent
 */
export interface AgentForkRequest {
  /** New agent identifier (required, must be globally unique) */
  identifier: string;
  /** New agent name (optional, defaults to "{original name} (Fork)") */
  name?: string;
  /** Status (optional, defaults to 'published') */
  status?: 'published' | 'unpublished' | 'archived' | 'deprecated';
  /** Version number to fork (optional, defaults to current version) */
  versionNumber?: number;
  /** Visibility (optional, defaults to 'public') */
  visibility?: 'public' | 'private' | 'internal';
}

/**
 * Fork response for Agent
 */
export interface AgentForkResponse {
  /** Newly created agent */
  agent: {
    createdAt: string;
    forkedFromAgentId: number;
    id: number;
    identifier: string;
    name: string;
    ownerId: number;
    updatedAt: string;
  };
  /** Source agent information */
  source: {
    agentId: number;
    identifier: string;
    versionNumber: number;
  };
  /** Newly created version */
  version: {
    agentId: number;
    createdAt: string;
    id: number;
    versionNumber: number;
  };
}

/**
 * Fork item for list display
 */
export interface AgentForkItem {
  createdAt: string;
  forkCount: number;
  id: number;
  identifier: string;
  name: string;
  ownerId: number;
  ownerName?: string;
  status?: string;
  visibility?: string;
}

/**
 * Forks list response
 */
export interface AgentForksResponse {
  forks: AgentForkItem[];
  totalCount: number;
}

/**
 * Fork source response
 */
export interface AgentForkSourceResponse {
  source: AgentForkItem | null;
}

/**
 * Fork request parameters for Agent Group
 */
export interface AgentGroupForkRequest {
  /** New group identifier (required, must be globally unique) */
  identifier: string;
  /** New group name (optional, defaults to "{original name} (Fork)") */
  name?: string;
  /** Status (optional, defaults to 'published') */
  status?: 'published' | 'unpublished' | 'archived' | 'deprecated';
  /** Version number to fork (optional, defaults to current version) */
  versionNumber?: number;
  /** Visibility (optional, defaults to 'public') */
  visibility?: 'public' | 'private' | 'internal';
}

/**
 * Fork response for Agent Group
 */
export interface AgentGroupForkResponse {
  /** Newly created agent group */
  group: {
    createdAt: string;
    forkedFromGroupId: number;
    id: number;
    identifier: string;
    name: string;
    ownerId: number;
    updatedAt: string;
  };
  /** Newly created group version */
  groupVersion: {
    agentGroupId: number;
    createdAt: string;
    id: number;
    versionNumber: number;
  };
  /** Copied member agents */
  memberAgents: Array<{
    id: number;
    identifier: string;
    name: string;
    role: string;
  }>;
  /** Copied member versions */
  memberVersions: Array<{
    agentForGroupId: number;
    id: number;
    versionNumber: number;
  }>;
  /** Source group information */
  source: {
    groupId: number;
    identifier: string;
    versionNumber: number;
  };
}

/**
 * Fork item for Agent Group list display
 */
export interface AgentGroupForkItem {
  createdAt: string;
  forkCount: number;
  id: number;
  identifier: string;
  name: string;
  ownerId: number;
}

/**
 * Agent Group forks list response
 */
export interface AgentGroupForksResponse {
  forks: AgentGroupForkItem[];
  totalCount: number;
}

/**
 * Agent Group fork source response
 */
export interface AgentGroupForkSourceResponse {
  source: AgentGroupForkItem | null;
}
