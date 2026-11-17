/**
 * Agent Management Executor
 *
 * Handles all agent management tool calls for creating, updating,
 * deleting and searching AI agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import { withLegacyCallAgentNote } from '@lobechat/builtin-tool-lobe-agent';
import { lobeAgentExecutor } from '@lobechat/builtin-tool-lobe-agent/client/executor';
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';

import {
  AgentManagementApiName,
  AgentManagementIdentifier,
  type CallAgentParams,
  type CreateAgentParams,
  type DeleteAgentParams,
  type DuplicateAgentParams,
  type GetAgentDetailParams,
  type InstallPluginParams,
  type SearchAgentParams,
  type SearchMarketToolsParams,
  type UpdateAgentParams,
  type UpdatePromptParams,
} from './types';

const runtime = new AgentManagerRuntime({
  agentService,
  discoverService,
});

class AgentManagementExecutor extends BaseExecutor<typeof AgentManagementApiName> {
  readonly identifier = AgentManagementIdentifier;
  protected readonly apiEnum = AgentManagementApiName;

  // ==================== Agent CRUD ====================

  createAgent = async (params: CreateAgentParams): Promise<BuiltinToolResult> => {
    return runtime.createAgent(params);
  };

  updateAgent = async (params: UpdateAgentParams): Promise<BuiltinToolResult> => {
    const { agentId } = params;
    // LLMs sometimes double-encode JSON, sending config/meta as stringified JSON
    // instead of objects. Parse them defensively before passing to runtime.
    let { config, meta } = params;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch {
        /* ignore */
      }
    }
    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta);
      } catch {
        /* ignore */
      }
    }
    return runtime.updateAgentConfig(agentId, { config, meta });
  };

  deleteAgent = async (params: DeleteAgentParams): Promise<BuiltinToolResult> => {
    return runtime.deleteAgent(params.agentId);
  };

  getAgentDetail = async (params: GetAgentDetailParams): Promise<BuiltinToolResult> => {
    return runtime.getAgentDetail(params.agentId);
  };

  duplicateAgent = async (params: DuplicateAgentParams): Promise<BuiltinToolResult> => {
    return runtime.duplicateAgent(params.agentId, params.newTitle);
  };

  updatePrompt = async (params: UpdatePromptParams): Promise<BuiltinToolResult> => {
    return runtime.updatePrompt(params.agentId, { prompt: params.prompt });
  };

  installPlugin = async (params: InstallPluginParams): Promise<BuiltinToolResult> => {
    return runtime.installPlugin(params.agentId, {
      identifier: params.identifier,
      source: params.source,
    });
  };

  // ==================== Search ====================

  searchAgent = async (params: SearchAgentParams): Promise<BuiltinToolResult> => {
    return runtime.searchAgents(params);
  };

  searchMarketTools = async (params: SearchMarketToolsParams): Promise<BuiltinToolResult> => {
    return runtime.searchMarketTools(params);
  };

  // ==================== Execution (retired) ====================

  /**
   * Retired: handing work to another agent is `lobe-agent.callSubAgent` with
   * `agentId`. Kept as an alias for calls from old prompts and cached tool
   * lists — it forwards there and every result asks the model to switch.
   *
   * In a group, members answer through `lobe-group-management.speak`; the old
   * group branch (an after-turn `triggerSpeak`) is not kept.
   */
  callAgent = async (
    params: CallAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.groupId) {
      return {
        content: withLegacyCallAgentNote(
          'callAgent is not available in group conversations. To have a member respond, use the group-management `speak` tool.',
        ),
        success: false,
      };
    }

    const result = await lobeAgentExecutor.callSubAgent(
      {
        agentId: params.agentId,
        description: '',
        instruction: params.instruction,
        runInBackground: params.runInBackground,
      },
      ctx,
    );

    return { ...result, content: withLegacyCallAgentNote(result.content ?? '') };
  };
}

export const agentManagementExecutor = new AgentManagementExecutor();
