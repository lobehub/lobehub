/* eslint-disable typescript-sort-keys/interface */
import type { FileContent, KnowledgeBaseInfo, PageContentContext } from '@lobechat/prompts';
import type { RuntimeInitialContext, RuntimeStepContext } from '@lobechat/types';

import type { OpenAIChatMessage, UIChatMessage } from '@/types/index';

import type { AgentInfo } from '../../processors/GroupRoleTransform';
import type { AgentBuilderContext } from '../../providers/AgentBuilderContextInjector';
import type { GTDPlan } from '../../providers/GTDPlanInjector';
import type { GTDTodoList } from '../../providers/GTDTodoInjector';
import type { GroupAgentBuilderContext } from '../../providers/GroupAgentBuilderContextInjector';
import type { GroupMemberInfo } from '../../providers/GroupContextInjector';
import type { LobeToolManifest } from '../tools/types';

/**
 * Model capability checker
 * Injected by caller to check if model supports specific capabilities
 */
export interface ModelCapabilityChecker {
  /** Check if function calling is supported */
  isCanUseFC?: (model: string, provider: string) => boolean;
  /** Check if video is supported */
  isCanUseVideo?: (model: string, provider: string) => boolean;
  /** Check if vision is supported */
  isCanUseVision?: (model: string, provider: string) => boolean;
}

/**
 * Knowledge configuration
 */
export interface KnowledgeConfig {
  /** File contents to inject */
  fileContents?: FileContent[];
  /** Knowledge base metadata to inject */
  knowledgeBases?: KnowledgeBaseInfo[];
}

/**
 * Tools configuration
 */
export interface ToolsConfig {
  /** Tool manifests with systemRole and API definitions */
  manifests?: LobeToolManifest[];
  /** Enabled tool IDs (kept for compatibility) */
  tools?: string[];
}

/**
 * Variable generators for placeholder replacement
 * Used to replace {{variable}} placeholders in messages
 */
export type VariableGenerators = Record<string, () => string>;

/**
 * File context configuration
 */
export interface FileContextConfig {
  /** Whether to enable file context injection */
  enabled: boolean;
  /** Whether to include file URLs (desktop typically uses false) */
  includeFileUrl: boolean;
}

/**
 * User memory item interfaces
 * Uses index signature to allow additional properties from database models
 * Note: Properties can be null (from database) or undefined
 */
export interface UserMemoryContextItem {
  description?: string | null;
  id?: string;
  title?: string | null;
  [key: string]: unknown;
}

export interface UserMemoryExperienceItem {
  id?: string;
  keyLearning?: string | null;
  situation?: string | null;
  [key: string]: unknown;
}

export interface UserMemoryPreferenceItem {
  conclusionDirectives?: string | null;
  id?: string;
  [key: string]: unknown;
}

export interface UserMemoryActivityItem {
  endsAt?: string | Date | null;
  id?: string;
  startsAt?: string | Date | null;
  status?: string | null;
  timezone?: string | null;
  type?: string | null;
  [key: string]: unknown;
}

export interface UserMemoryIdentityItem {
  description?: string | null;
  id?: string;
  role?: string | null;
  /** Identity type: personal (role), professional (occupation), demographic (attribute) */
  type?: 'demographic' | 'personal' | 'professional' | string | null;
  [key: string]: unknown;
}

/**
 * User memory data structure
 * Compatible with SearchMemoryResult from @lobechat/types
 */
export interface UserMemoryData {
  activities?: UserMemoryActivityItem[];
  contexts: UserMemoryContextItem[];
  experiences: UserMemoryExperienceItem[];
  identities?: UserMemoryIdentityItem[];
  preferences: UserMemoryPreferenceItem[];
}

/**
 * User memory configuration
 */
export interface UserMemoryConfig {
  /** Whether user memory is enabled */
  enabled?: boolean;
  /** When the memories were fetched */
  fetchedAt?: number;
  /** User memories data */
  memories?: UserMemoryData;
}

/**
 * Agent group configuration
 * Used to inject sender identity into assistant messages in multi-agent scenarios
 */
export interface AgentGroupConfig {
  /** Mapping from agentId to agent info (name, role) */
  agentMap?: Record<string, AgentInfo>;

  // ========== Group context injection (for current agent's identity) ==========
  /** Current agent's ID (the one who will respond) */
  currentAgentId?: string;
  /** Current agent's name */
  currentAgentName?: string;
  /** Current agent's role */
  currentAgentRole?: 'supervisor' | 'participant';
  /** Group title/name */
  groupTitle?: string;
  /** List of group members for context injection */
  members?: GroupMemberInfo[];
  /** Custom system prompt/role description for the group */
  systemPrompt?: string;
}

/**
 * GTD (Getting Things Done) configuration
 * Used to inject plan and todo context for task management
 */
export interface GTDConfig {
  /** Whether GTD context injection is enabled */
  enabled?: boolean;
  /** The current plan to inject (injected before first user message) */
  plan?: GTDPlan;
  /** The current todo list to inject (injected at end of last user message) */
  todos?: GTDTodoList;
}

/**
 * MessagesEngine main parameters
 */
export interface MessagesEngineParams {
  // ========== Required parameters ==========
  /** Original message list */
  messages: UIChatMessage[];
  /** Model ID */
  model: string;
  /** Provider ID */
  provider: string;

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
  /** System role */
  systemRole?: string;

  // ========== Capability injection (dependency injection) ==========
  /** Model capability checker */
  capabilities?: ModelCapabilityChecker;
  /** Variable generators for placeholder replacement */
  variableGenerators?: VariableGenerators;

  // ========== Knowledge ==========
  /** Knowledge configuration */
  knowledge?: KnowledgeConfig;

  // ========== Tools ==========
  /** Tools configuration */
  toolsConfig?: ToolsConfig;

  // ========== File handling ==========
  /** File context configuration */
  fileContext?: FileContextConfig;

  // ========== Extended contexts (both frontend and backend) ==========
  /** Agent Builder context */
  agentBuilderContext?: AgentBuilderContext;
  /** Agent group configuration for multi-agent scenarios */
  agentGroup?: AgentGroupConfig;
  /** Group Agent Builder context */
  groupAgentBuilderContext?: GroupAgentBuilderContext;
  /** GTD (Getting Things Done) configuration */
  gtd?: GTDConfig;
  /** Reaction feedback configuration */
  reactionFeedback?: {
    enabled?: boolean;
  };
  /** User memory configuration */
  userMemory?: UserMemoryConfig;

  // ========== Page Editor context ==========
  /**
   * Initial context captured at operation start (frontend runtime usage)
   * Contains static state like initial page content that doesn't change during execution
   */
  initialContext?: RuntimeInitialContext;
  /**
   * Page content context for direct injection (server-side usage)
   * When provided, takes precedence over initialContext/stepContext
   */
  pageContentContext?: PageContentContext;
  /**
   * Step context computed at the beginning of each step (frontend runtime usage)
   * Contains dynamic state like latest XML that changes between steps
   */
  stepContext?: RuntimeStepContext;
}

/**
 * MessagesEngine result
 */
export interface MessagesEngineResult {
  /** Processed messages in OpenAI format */
  messages: OpenAIChatMessage[];
  /** Processing metadata */
  metadata: Record<string, any>;
  /** Processing statistics */
  stats: {
    /** Number of processors executed */
    processedCount: number;
    /** Execution time for each processor */
    processorDurations: Record<string, number>;
    /** Total processing time in ms */
    totalDuration: number;
  };
}

// Re-export types for convenience

export { type AgentInfo } from '../../processors/GroupRoleTransform';
export { type AgentBuilderContext } from '../../providers/AgentBuilderContextInjector';
export { type GroupAgentBuilderContext } from '../../providers/GroupAgentBuilderContextInjector';
export { type GTDPlan } from '../../providers/GTDPlanInjector';
export { type GTDTodoItem, type GTDTodoList } from '../../providers/GTDTodoInjector';
export { type OpenAIChatMessage, type UIChatMessage } from '@/types/index';
export { type FileContent, type KnowledgeBaseInfo } from '@lobechat/prompts';
