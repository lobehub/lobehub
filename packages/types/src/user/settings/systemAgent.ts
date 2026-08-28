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

export type UserSystemAgentConfigKey = keyof UserSystemAgentConfig;
export type UserMemoryServiceModelConfigKey = keyof UserMemoryServiceModelConfig;
export type UserServiceModelConfigKey = keyof UserServiceModelConfig;
