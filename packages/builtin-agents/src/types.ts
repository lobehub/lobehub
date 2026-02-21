import type { LobeAgentChatConfig, LobeAgentConfig } from '@lobechat/types';

import type { GroupSupervisorContext } from './agents/group-supervisor/type';

/**
 * Builtin Agent Slugs - unique identifiers for builtin agents
 */
export const BUILTIN_AGENT_SLUGS = {
  agentBuilder: 'agent-builder',
  groupAgentBuilder: 'group-agent-builder',
  groupSupervisor: 'group-supervisor',
  inbox: 'inbox',
  pageAgent: 'page-agent',
} as const;

export type BuiltinAgentSlug = (typeof BUILTIN_AGENT_SLUGS)[keyof typeof BUILTIN_AGENT_SLUGS];

/**
 * Persist Config - these fields will be stored in the database
 */
export interface BuiltinAgentPersistConfig {
  /** Default chat configuration */
  chatConfig?: Partial<LobeAgentChatConfig>;
  /** Default model */
  model?: string;
  /** Default provider */
  provider?: string;
}

/**
 * Runtime Result - dynamically generated config, not persisted
 */
export interface BuiltinAgentRuntimeResult {
  /** Runtime chat configuration overrides */
  chatConfig?: Partial<LobeAgentChatConfig>;

  /** Plugins to enable for the agent */
  plugins?: string[];

  /** Dynamically generated system role */
  systemRole: string;
}

/**
 * Runtime Context - context passed to runtime function
 */
export interface RuntimeContext {
  /** Document content for PageAgent */
  documentContent?: string;

  /** Context for GroupSupervisor */
  groupSupervisorContext?: GroupSupervisorContext;

  /** Current model being used */
  model?: string;

  /** Plugins enabled for the agent */
  plugins?: string[];

  /** Target agent config for AgentBuilder */
  targetAgentConfig?: LobeAgentConfig;

  /** User's locale */
  userLocale?: string;
}

/**
 * Runtime config - can be either a function or a plain object
 * - Function: (ctx: RuntimeContext) => BuiltinAgentRuntimeResult
 * - Object: BuiltinAgentRuntimeResult (static config)
 */
export type BuiltinAgentRuntimeConfig =
  | ((ctx: RuntimeContext) => BuiltinAgentRuntimeResult)
  | BuiltinAgentRuntimeResult;

/**
 * Builtin Agent Definition - complete definition with persist and runtime parts
 */
export interface BuiltinAgentDefinition {
  avatar?: string;
  /**
   * Persist config - stored in database
   */
  persist?: BuiltinAgentPersistConfig;

  /**
   * Runtime config - generates dynamic config based on context
   * Can be either:
   * - A function that takes RuntimeContext and returns BuiltinAgentRuntimeResult
   * - A plain BuiltinAgentRuntimeResult object (for static systemRole)
   */
  runtime: BuiltinAgentRuntimeConfig;

  /**
   * Unique identifier for the builtin agent
   */
  slug: BuiltinAgentSlug;
}
