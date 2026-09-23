import type { LobeAgentAgencyConfig, LobeAgentChatConfig, LobeAgentConfig } from '@lobechat/types';

import type { GroupSupervisorContext } from './agents/group-supervisor/type';

/**
 * Builtin Agent Slugs - unique identifiers for builtin agents
 */
export const BUILTIN_AGENT_SLUGS = {
  agentBuilder: 'agent-builder',
  groupAgentBuilder: 'group-agent-builder',
  groupSupervisor: 'group-supervisor',
  inbox: 'inbox',
  inboxIntake: 'inbox-intake',
  issuePrd: 'issue-prd',
  knowledgeCurator: 'knowledge-curator',
  nightlyReview: 'nightly-review',
  onboardingUnderstanding: 'onboarding-understanding',
  onboardingTaskRecommender: 'onboarding-task-recommender',
  pageAgent: 'page-agent',
  quickNoteAnalyze: 'quick-note-analyze',
  quickNoteDive: 'quick-note-dive',
  selfFeedbackIntent: 'self-feedback-intent',
  selfReflection: 'self-reflection',
  skillManagement: 'skill-management',
  taskAgent: 'task-agent',
  verifyAgent: 'verify-agent',
  webOnboarding: 'web-onboarding',
} as const;

export type BuiltinAgentSlug = (typeof BUILTIN_AGENT_SLUGS)[keyof typeof BUILTIN_AGENT_SLUGS];

/**
 * Persist Config - these fields will be stored in the database
 */
export interface BuiltinAgentPersistConfig {
  /** Default chat configuration */
  chatConfig?: Partial<LobeAgentChatConfig>;
  /** Default description shown on direct configuration surfaces. */
  description?: string;
  /** Default model */
  model?: string;
  /** Default tools stored with the lazily materialized Agent. */
  plugins?: string[];
  /** Default provider */
  provider?: string;
  /** Default display title shown on direct configuration surfaces. */
  title?: string;
}

/**
 * Runtime Result - dynamically generated config, not persisted
 */
export interface BuiltinAgentRuntimeResult {
  /** Runtime agency configuration overrides */
  agencyConfig?: Partial<LobeAgentAgencyConfig>;

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
  /**
   * The agent's personal name as the user sees it (e.g. a renamed default
   * assistant). Builtin system roles should introduce themselves by this name
   * instead of the hardcoded product default.
   */
  agentName?: string;

  /** The agent's role title ("Health Assistant"), shown alongside the name. */
  agentTitle?: string;

  /** Document content for PageAgent */
  documentContent?: string;

  /** Context for GroupSupervisor */
  groupSupervisorContext?: GroupSupervisorContext;

  /** Whether running in development mode */
  isDev?: boolean;

  /** Current model being used */
  model?: string;

  /** Plugins enabled for the agent */
  plugins?: string[];

  /**
   * The system role stored on the agent row, when the user customized it.
   * Builtins whose runtime prompt is only a default the user may edit (the
   * renameable inbox assistant) honor it; builtins whose prompt is the
   * feature itself (page / task / supervisor) ignore it or embed it via
   * their own context.
   */
  storedSystemRole?: string;

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
  ((ctx: RuntimeContext) => BuiltinAgentRuntimeResult) | BuiltinAgentRuntimeResult;

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
  /** Whether product defaults stop overwriting the materialized Agent after creation. */
  userConfigurable?: boolean;
}
