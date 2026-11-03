import type { BuiltinInspector } from '@lobechat/types';

import { AgentBuilderApiName } from '../../types';
import { GetAvailableModelsInspector } from './GetAvailableModels';
import { InstallPluginInspector } from './InstallPlugin';
import { SearchMarketToolsInspector } from './SearchMarketTools';
import { UpdateConfigInspector } from './UpdateConfig';
import { UpdatePromptInspector } from './UpdatePrompt';

/**
 * Agent Builder Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const AgentBuilderInspectors: Record<string, BuiltinInspector> = {
  [AgentBuilderApiName.getAvailableModels]: GetAvailableModelsInspector as BuiltinInspector,
  [AgentBuilderApiName.installPlugin]: InstallPluginInspector as BuiltinInspector,
  [AgentBuilderApiName.searchMarketTools]: SearchMarketToolsInspector as BuiltinInspector,
  [AgentBuilderApiName.updateAgentConfig]: UpdateConfigInspector as BuiltinInspector,
  [AgentBuilderApiName.updatePrompt]: UpdatePromptInspector as BuiltinInspector,
};

// Re-export individual inspectors for reuse in group-agent-builder
export { GetAvailableModelsInspector } from './GetAvailableModels';
export { InstallPluginInspector } from './InstallPlugin';
export { SearchMarketToolsInspector } from './SearchMarketTools';
export { UpdateConfigInspector } from './UpdateConfig';
export { UpdatePromptInspector } from './UpdatePrompt';
