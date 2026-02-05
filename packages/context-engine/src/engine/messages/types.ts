/* eslint-disable typescript-sort-keys/interface */
import type { FileContent, KnowledgeBaseInfo, PageContentContext } from '@lobechat/prompts';
import type { RuntimeInitialContext, RuntimeStepContext } from '@lobechat/types';

import type { OpenAIChatMessage, UIChatMessage } from '@/types/index';

import type { AgentInfo } from '../../processors/GroupRoleTransform';
import type { AgentBuilderContext } from '../../providers/AgentBuilderContextInjector';
import type { GroupAgentBuilderContext } from '../../providers/GroupAgentBuilderContextInjector';
import type { GroupMemberInfo } from '../../providers/GroupContextInjector';
import type { GTDPlan } from '../../providers/GTDPlanInjector';
import type { GTDTodoList } from '../../providers/GTDTodoInjector';
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
  [key: string]: unknown;
  description?: string | null;
  id?: string;
  title?: string | null;
}

export interface UserMemoryExperienceItem {
  [key: string]: unknown;
  id?: string;
  keyLearning?: string | null;
  situation?: string | null;
}

export interface UserMemoryPreferenceItem {
  [key: string]: unknown;
  conclusionDirectives?: string | null;
  id?: string;
}

export interface UserMemoryActivityItem {
  [key: string]: unknown;
  endsAt?: string | Date | null;
  id?: string;
  startsAt?: string | Date | null;
  status?: string | null;
  timezone?: string | null;
  type?: string | null;
}

export interface UserMemoryIdentityItem {
  [key: string]: unknown;
  description?: string | null;
  id?: string;
  role?: string | null;
  /** Identity type: personal (role), professional (occupation), demographic (attribute) */
  type?: 'demographic' | 'personal' | 'professional' | string | null;
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
  // ========== Extended contexts (both frontend and backend) ==========
  /** Agent Builder context */
  agentBuilderContext?: AgentBuilderContext;
  /** Agent group configuration for multi-agent scenarios */
  agentGroup?: AgentGroupConfig;
  // ========== Capability injection (dependency injection) ==========
  /** Model capability checker */
  capabilities?: ModelCapabilityChecker;

  // ========== Agent configuration ==========
  /** Whether to enable history message count limit */
  enableHistoryCount?: boolean;
  // ========== File handling ==========
  /** File context configuration */
  fileContext?: FileContextConfig;
  /** Function to format history summary */
  formatHistorySummary?: (summary: string) => string;
  /** Group Agent Builder context */
  groupAgentBuilderContext?: GroupAgentBuilderContext;
  /** GTD (Getting Things Done) configuration */
  gtd?: GTDConfig;
  /** History message count limit */
  historyCount?: number;

  /** History summary content */
  historySummary?: string;
  // ========== Page Editor context ==========
  /**
   * Initial context captured at operation start (frontend runtime usage)
   * Contains static state like initial page content that doesn't change during execution
   */
  initialContext?: RuntimeInitialContext;

  /** Input template */
  inputTemplate?: string;

  // ========== Knowledge ==========
  /** Knowledge configuration */
  knowledge?: KnowledgeConfig;

  // ========== Required parameters ==========
  /** Original message list */
  messages: UIChatMessage[];

  /** Model ID */
  model: string;
  /**
   * Page content context for direct injection (server-side usage)
   * When provided, takes precedence over initialContext/stepContext
   */
  pageContentContext?: PageContentContext;
  /** Provider ID */
  provider: string;
  /**
   * Step context computed at the beginning of each step (frontend runtime usage)
   * Contains dynamic state like latest XML that changes between steps
   */
  stepContext?: RuntimeStepContext;
  /** System role */
  systemRole?: string;

  // ========== Tools ==========
  /** Tools configuration */
  toolsConfig?: ToolsConfig;
  /** User memory configuration */
  userMemory?: UserMemoryConfig;
  /** Variable generators for placeholder replacement */
  variableGenerators?: VariableGenerators;
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
