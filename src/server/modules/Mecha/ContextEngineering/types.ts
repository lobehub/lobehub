import {
  type AgentBuilderContext,
  type FileContent,
  type KnowledgeBaseInfo,
  type LobeToolManifest,
  type UserMemoryData,
} from '@lobechat/context-engine';
import { type PageContentContext } from '@lobechat/prompts';
import { type UIChatMessage } from '@lobechat/types';

/**
 * Model capability checker functions for server-side
 */
export interface ServerModelCapabilities {
  /** Check if function calling is supported */
  isCanUseFC?: (model: string, provider: string) => boolean;
  /** Check if video is supported */
  isCanUseVideo?: (model: string, provider: string) => boolean;
  /** Check if vision is supported */
  isCanUseVision?: (model: string, provider: string) => boolean;
}

/**
 * Knowledge configuration for server context engineering
 */
export interface ServerKnowledgeConfig {
  /** File contents to inject */
  fileContents?: FileContent[];
  /** Knowledge base metadata to inject */
  knowledgeBases?: KnowledgeBaseInfo[];
}

/**
 * Tools configuration for server context engineering
 */
export interface ServerToolsConfig {
  /** Tool manifests with systemRole and API definitions */
  manifests?: LobeToolManifest[];
  /** Enabled tool IDs (kept for compatibility) */
  tools?: string[];
}

/**
 * User memory configuration for server context engineering
 */
export interface ServerUserMemoryConfig {
  /** When the memories were fetched */
  fetchedAt?: number;
  /** User memories data */
  memories?: UserMemoryData;
}

/**
 * Server-side messages engine parameters
 *
 * Unlike frontend, backend receives all data as parameters
 * instead of fetching from stores
 */
export interface ServerMessagesEngineParams {
  // ========== Extended contexts ==========
  /** Agent Builder context (optional, for editing agents) */
  agentBuilderContext?: AgentBuilderContext;
  // ========== Capability injection ==========
  /** Model capability checkers */
  capabilities?: ServerModelCapabilities;
  // ========== Agent configuration ==========
  /** Whether to enable history message count limit */
  enableHistoryCount?: boolean;

  /** Function to format history summary */
  formatHistorySummary?: (summary: string) => string;
  /** History message count limit */
  historyCount?: number;
  /** History summary content */
  historySummary?: string;
  /** Input template */
  inputTemplate?: string;
  // ========== Knowledge ==========
  /** Knowledge configuration */
  knowledge?: ServerKnowledgeConfig;
  // ========== Required parameters ==========
  /** Original message list */
  messages: UIChatMessage[];

  /** Model ID */
  model: string;

  /** Page content context (optional, for document editing) */
  pageContentContext?: PageContentContext;

  /** Provider ID */
  provider: string;

  /** System role */
  systemRole?: string;

  // ========== Tools ==========
  /** Tools configuration */
  toolsConfig?: ServerToolsConfig;
  // ========== User memory ==========
  /** User memory configuration */
  userMemory?: ServerUserMemoryConfig;
}

// Re-export types for convenience

export {
  type AgentBuilderContext,
  type FileContent,
  type KnowledgeBaseInfo,
  type UserMemoryData,
} from '@lobechat/context-engine';
export type { PageContentContext } from '@lobechat/prompts';
