/**
 * Agent Management Executor
 *
 * Handles all agent management tool calls for creating, updating,
 * deleting, searching, and calling AI agents.
 * Delegates to AgentManagerRuntime for actual implementation.
 */
import { AgentManagerRuntime } from '@lobechat/agent-manager-runtime';
import { BaseExecutor, type BuiltinToolResult } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';

import {
  AgentManagementApiName,
  AgentManagementIdentifier,
  type CallAgentParams,
  type CallAgentState,
  type CreateAgentParams,
  type DeleteAgentParams,
  type DuplicateAgentParams,
  type GetAgentDetailParams,
  type InstallPluginParams,
  type SearchAgentParams,
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

  // ==================== Execution ====================

  callAgent = async (params: CallAgentParams): Promise<BuiltinToolResult> => {
    const { agentId, instruction, skipCallSupervisor = false } = params;

    // `callAgent` runs on the server (the agent loop is server-side; see
    // `serverRuntimes/agentManagement`). There is no browser runtime to hand
    // the call to, so a browser invocation reports that instead of pretending.
    return {
      content: `Calling agent "${agentId}" is only supported in server-side agent runs.`,
      state: {
        agentId,
        instruction,
        mode: 'speak',
        skipCallSupervisor,
      } as CallAgentState,
      stop: true,
      success: false,
    };
  };
}

export const agentManagementExecutor = new AgentManagementExecutor();
