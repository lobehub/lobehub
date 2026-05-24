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
  followUpAction: SystemAgentItem;
  generationTopic: SystemAgentItem;
  historyCompress: SystemAgentItem;
  inputCompletion: SystemAgentItem;
  promptRewrite: PromptRewriteSystemAgent;
  thread: SystemAgentItem;
  topic: SystemAgentItem;
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
