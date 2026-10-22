export interface SystemAgentItem {
  contextLimit?: number;
  customPrompt?: string;
  enabled?: boolean;
  model: string;
  provider: string;
}

export interface PromptRewriteSystemAgent extends Omit<SystemAgentItem, 'enabled'> {
  enabled: boolean;
}

export interface UserSystemAgentConfig {
  agentMeta: SystemAgentItem;
  /**
   * Speech-to-text model that transcribes voice messages for runtimes that only take text
   * (heterogeneous agents). Empty `model`/`provider` means unconfigured: voice input that
   * depends on transcription stays hidden.
   */
  asr: SystemAgentItem;
  /** Decision model selecting which Channel members should respond to an unmentioned message. */
  channelRouting: SystemAgentItem;
  /** Model used to draft expertise domains and extract reusable experience from conversations. */
  expertise: SystemAgentItem;
  followUpAction: SystemAgentItem;
  generationTopic: SystemAgentItem;
  /** Model used to turn a persistent goal into its standing acceptance criteria. */
  goal: SystemAgentItem;
  historyCompress: SystemAgentItem;
  inputCompletion: SystemAgentItem;
  /** Model used to turn onboarding evidence into background-safe task recommendations. */
  onboardingTaskRecommender: SystemAgentItem;
  /** Model used to synthesize connector evidence into the onboarding understanding. */
  onboardingUnderstanding: SystemAgentItem;
  promptRewrite: PromptRewriteSystemAgent;
  thread: SystemAgentItem;
  topic: SystemAgentItem;
  /** Background workflow that summarizes inactive topics into description/historySummary. */
  topicAutoSummary: SystemAgentItem;
  translation: SystemAgentItem;
}

export interface UserMemoryServiceModelConfig {
  memoryAnalysisAgentConfig: SystemAgentItem;
  userMemoryEmbedding: SystemAgentItem;
  userMemoryPersonaWriter: SystemAgentItem;
}

export interface UserServiceModelConfig
  extends UserSystemAgentConfig, UserMemoryServiceModelConfig {}

/**
 * The three models a user picks at the top of Service Model settings. Every
 * task slot follows one of them (see `SERVICE_MODEL_TIER_SLOTS`) unless the
 * user pins that slot to its own model.
 */
export type ServiceModelTier = 'embedding' | 'flash' | 'main';

export interface ServiceModelTierItem {
  model: string;
  provider: string;
}

/**
 * Tier choices stored next to the task slots in the `systemAgent` column. An
 * absent tier follows the system recommendation. A chosen tier is also written
 * into each slot that follows it, so every runtime that reads a slot directly
 * gets the tier model without knowing tiers exist.
 */
export type ServiceModelTierConfig = Partial<Record<ServiceModelTier, ServiceModelTierItem>>;

export type UserSystemAgentConfigKey = keyof UserSystemAgentConfig;
export type UserMemoryServiceModelConfigKey = keyof UserMemoryServiceModelConfig;
export type UserServiceModelConfigKey = keyof UserServiceModelConfig;

/**
 * Service-model entries that only shape the user's own chat surface (their
 * input box and the chips under replies). They stay personal preferences even
 * inside a workspace: every member may change them, unlike the rest of
 * `systemAgent`, which requires workspace settings permission there.
 */
export const PERSONAL_SYSTEM_AGENT_KEYS = [
  'followUpAction',
  'inputCompletion',
] as const satisfies readonly UserSystemAgentConfigKey[];

export type PersonalSystemAgentKey = (typeof PERSONAL_SYSTEM_AGENT_KEYS)[number];
