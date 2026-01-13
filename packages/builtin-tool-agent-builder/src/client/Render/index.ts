import { AgentBuilderApiName } from '../../types';
import GetAvailableModels from './GetAvailableModels';
import InstallPlugin from './InstallPlugin';
import SearchMarketTools from './SearchMarketTools';
import UpdateConfig from './UpdateConfig';
import UpdatePrompt from './UpdatePrompt';

/**
 * Agent Builder Render Components Registry
 *
 * Note: Read operations (GetConfig, GetMeta, GetPrompt, GetAvailableTools, SearchOfficialTools) are removed
 * because the current agent context is now automatically injected into the conversation.
 *
 * Note: Specific field operations (SetModel, SetOpeningMessage, SetOpeningQuestions, UpdateChatConfig, UpdateMeta, TogglePlugin)
 * are removed and consolidated into updateAgentConfig.
 */
export const AgentBuilderRenders = {
  // Read operations
  [AgentBuilderApiName.getAvailableModels]: GetAvailableModels,
  [AgentBuilderApiName.searchMarketTools]: SearchMarketTools,

  // Write operations
  [AgentBuilderApiName.installPlugin]: InstallPlugin,
  [AgentBuilderApiName.updateAgentConfig]: UpdateConfig,
  [AgentBuilderApiName.updatePrompt]: UpdatePrompt,
};
