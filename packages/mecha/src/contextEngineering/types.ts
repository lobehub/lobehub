import type {
  AgentBuilderContext,
  AgentContextDocument,
  AgentGroupConfig,
  AgentManagementContext,
  BotPlatformContext,
  DiscordContext,
  EvalContext,
  FileContextConfig,
  GroupAgentBuilderContext,
  KnowledgeConfig,
  LobeToolManifest,
  ModelCapabilityChecker,
  OnboardingContext,
  PlanTodoConfig,
  ProjectInstructionFile,
  SkillMeta,
  ToolDiscoveryConfig,
  TopicReferenceItem,
  UserMemoryConfig,
  WorkspaceContext,
} from '@lobechat/context-engine';
import type { AgentIdentityContext, PageContentContext } from '@lobechat/prompts';
import type {
  ExpertiseContextSnapshot,
  RuntimeAdditionalContextFragment,
  RuntimeInitialContext,
  RuntimeSelectedSkill,
  RuntimeSelectedTool,
  RuntimeStepContext,
  UIChatMessage,
} from '@lobechat/types';

/**
 * The agent definition as it shapes the prompt: who the agent is and how it
 * wants its history and knowledge presented. Resolved once per run by the
 * host (`resolveAgentConfig`) and frozen.
 */
export interface ContextAgentSnapshot {
  /** Agent documents the agent may consult. */
  documents?: AgentContextDocument[];
  enableHistoryCount?: boolean;
  historyCount?: number;
  /** Identity shown to the model so it introduces itself by the user-given name. */
  identity?: AgentIdentityContext;
  inputTemplate?: string;
  /** Files and knowledge bases attached to the agent. */
  knowledge?: KnowledgeConfig;
  systemRole?: string;
}

/**
 * The model the turn is sent to, and what it can consume.
 */
export interface ContextModelSnapshot {
  capabilities?: ModelCapabilityChecker;
  displayName?: string;
  knowledgeCutoff?: string;
  model: string;
  provider: string;
}

/**
 * What the run itself carries into the turn: the conversation and the
 * runtime's own flags. Changes every step.
 */
export interface ContextRunSnapshot {
  additionalContexts?: readonly RuntimeAdditionalContextFragment[];
  /**
   * Runtime-resolved agent mode. `false` forces chat mode (skills and agent
   * documents are not injected) regardless of the stored chat config.
   */
  enableAgentMode?: boolean;
  enableExpertise?: boolean;
  expertise?: ExpertiseContextSnapshot;
  /** maxSteps exceeded: tools are stripped and a summary prompt is injected. */
  forceFinish?: boolean;
  formatHistorySummary?: (summary: string) => string;
  historySummary?: string;
  initialContext?: RuntimeInitialContext;
  messages: UIChatMessage[];
  stepContext?: RuntimeStepContext;
}

/**
 * Tools and skills the turn may use, already resolved for this step.
 */
export interface ContextToolsSnapshot {
  /**
   * Tool identifiers whose system roles must not be injected even though the
   * tool is enabled. Defaults to hiding the page agent unless it is enabled.
   */
  disabledToolIdentifiers?: string[];
  enabledSkills?: SkillMeta[];
  enabledToolIds?: string[];
  manifests?: LobeToolManifest[];
  /** Skills the user pinned for this request. */
  selectedSkills?: RuntimeSelectedSkill[];
  /** Tools the user pinned for this request. */
  selectedTools?: RuntimeSelectedTool[];
  toolDiscoveryConfig?: ToolDiscoveryConfig;
}

/**
 * Facts about the run's world that are fixed when the operation is created:
 * the roster, the project's instructions, the user's memory and timezone, the
 * channel the run came in on. Mirrors `AgentState.world`.
 */
export interface ContextWorldSnapshot {
  botPlatformContext?: BotPlatformContext;
  connectorOwnershipNote?: string;
  discordContext?: DiscordContext;
  evalContext?: EvalContext;
  group?: AgentGroupConfig;
  projectInstructions?: ProjectInstructionFile[];
  userMemory?: UserMemoryConfig;
  userTimezone?: string;
}

/**
 * Facts gathered fresh for this step because they move while the run executes:
 * the plan, referenced topics, the page being edited, builder / onboarding
 * state. The host decides how to fetch them; the core only places them.
 */
export interface ContextStepSnapshot {
  agentBuilderContext?: AgentBuilderContext;
  agentManagementContext?: AgentManagementContext;
  groupAgentBuilderContext?: GroupAgentBuilderContext;
  onboardingContext?: OnboardingContext;
  pageContentContext?: PageContentContext;
  planTodo?: PlanTodoConfig;
  topicReferences?: TopicReferenceItem[];
  workspaceContext?: WorkspaceContext;
}

/**
 * Everything the context engine needs to turn a run's state into the messages
 * sent to the model. Hosts assemble it from their own sources (runtime state
 * slots, database rows, client stores); the core is a pure function of it.
 */
export interface ContextSnapshot {
  agent: ContextAgentSnapshot;
  /**
   * How attached files are referenced. Server-side URLs resolve to stable
   * proxy URLs; desktop-local URLs are not fetchable by remote providers.
   */
  fileContext?: FileContextConfig;
  model: ContextModelSnapshot;
  run: ContextRunSnapshot;
  step?: ContextStepSnapshot;
  tools?: ContextToolsSnapshot;
  /**
   * Host-resolved placeholder values (`{{username}}`, `{{CREDS_LIST}}`,
   * device paths …). They override the core's defaults and leak guards.
   */
  variables?: Record<string, string>;
  world?: ContextWorldSnapshot;
}
