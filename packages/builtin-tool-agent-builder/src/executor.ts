/**
 * Agent Builder Executor
 *
 * Handles all agent builder tool calls for configuring and customizing agents.
 */
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { AgentBuilderExecutionRuntime } from './ExecutionRuntime';
import type {
  GetAvailableModelsParams,
  InstallPluginParams,
  SearchMarketToolsParams,
  UpdateAgentConfigParams,
  UpdatePromptParams,
} from './types';
import { AgentBuilderApiName, AgentBuilderIdentifier } from './types';

const runtime = new AgentBuilderExecutionRuntime();

class AgentBuilderExecutor extends BaseExecutor<typeof AgentBuilderApiName> {
  readonly identifier = AgentBuilderIdentifier;
  protected readonly apiEnum = AgentBuilderApiName;

  // ==================== Read Operations ====================

  getAvailableModels = async (params: GetAvailableModelsParams): Promise<BuiltinToolResult> => {
    const result = await runtime.getAvailableModels(params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    const result = await runtime.searchMarketTools(params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  // ==================== Write Operations ====================

  updateConfig = async (
    params: UpdateAgentConfigParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No active agent found',
        error: { message: 'No active agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    const result = await runtime.updateAgentConfig(agentId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  updatePrompt = async (
    params: UpdatePromptParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No active agent found',
        error: { message: 'No active agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    const result = await runtime.updatePrompt(agentId, {
      streaming: true,
      ...params,
    });
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };

  installPlugin = async (
    params: InstallPluginParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const agentId = ctx.agentId;

    if (!agentId) {
      return {
        content: 'No active agent found',
        error: { message: 'No active agent found', type: 'NoAgentContext' },
        success: false,
      };
    }

    const result = await runtime.installPlugin(agentId, params);
    return {
      content: result.content,
      error: result.error
        ? { body: result.error, message: String(result.error), type: 'RuntimeError' }
        : undefined,
      state: result.state,
      success: result.success,
    };
  };
}

export const agentBuilderExecutor = new AgentBuilderExecutor();
