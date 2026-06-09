import { type LobeAgentChatConfig, type LobeAgentConfig } from '@lobechat/types';

type AgentModelModeConfig = Partial<Pick<LobeAgentConfig, 'chatConfig' | 'model' | 'provider'>>;

const FABLE_CHAT_ONLY_MODEL = 'claude-fable-5';
const FABLE_CHAT_ONLY_PROVIDER = 'lobehub';

export const isFableChatOnlyModel = (config?: AgentModelModeConfig): boolean =>
  config?.provider === FABLE_CHAT_ONLY_PROVIDER && config.model === FABLE_CHAT_ONLY_MODEL;

export const getChatConfigWithModelModeOverride = (
  config?: AgentModelModeConfig,
): LobeAgentChatConfig => {
  const chatConfig = config?.chatConfig || {};

  if (!isFableChatOnlyModel(config)) return chatConfig;

  return { ...chatConfig, enableAgentMode: false };
};
