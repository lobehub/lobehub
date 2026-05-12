import {
  AgentManagementIdentifier,
  type CallAgentParams,
  type CreateAgentParams,
  type DeleteAgentParams,
  type DuplicateAgentParams,
  type GetAgentDetailParams,
  type InstallPluginParams,
  type SearchAgentParams,
  type UpdateAgentParams,
  type UpdatePromptParams,
} from '@lobechat/builtin-tool-agent-management';

import { AgentModel } from '@/database/models/agent';
import { PluginModel } from '@/database/models/plugin';
import { DiscoverService } from '@/server/services/discover';

import { type ToolExecutionContext, type ToolExecutionResult } from '../types';
import { type ServerRuntimeRegistration } from './types';

const handleError = (error: unknown, message: string): ToolExecutionResult => {
  const err = error as Error;
  return { content: `${message}: ${err.message}`, success: false };
};

export const agentManagementRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Management execution');
    }

    const agentModel = new AgentModel(context.serverDB, context.userId);
    const pluginModel = new PluginModel(context.serverDB, context.userId);
    const discoverService = new DiscoverService();

    return {
      callAgent: async (
        params: CallAgentParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const { agentId, instruction, taskTitle, timeout } = params;

        // Server runtime always uses the task path because there is no
        // client-side `registerAfterCompletion` callback available to execute
        // synchronous agent calls.
        return {
          content: `🚀 Triggered async task to call agent "${agentId}"${taskTitle ? `: ${taskTitle}` : ''}`,
          state: {
            parentMessageId: ctx.messageId,
            task: {
              description: taskTitle || `Call agent ${agentId}`,
              instruction,
              targetAgentId: agentId,
              timeout: timeout || 1_800_000,
            },
            type: 'execSubAgent',
          },
          success: true,
        };
      },

      createAgent: async (params: CreateAgentParams): Promise<ToolExecutionResult> => {
        try {
          const agent = await agentModel.create({
            avatar: params.avatar,
            backgroundColor: params.backgroundColor,
            description: params.description,
            model: params.model,
            openingMessage: params.openingMessage,
            openingQuestions: params.openingQuestions,
            plugins: params.plugins,
            provider: params.provider,
            systemRole: params.systemRole,
            tags: params.tags,
            title: params.title,
          });

          return {
            content: `Successfully created agent "${params.title}" with ID: ${agent.id}`,
            state: { agentId: agent.id, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to create agent');
        }
      },

      deleteAgent: async (params: DeleteAgentParams): Promise<ToolExecutionResult> => {
        try {
          await agentModel.delete(params.agentId);
          return {
            content: `Successfully deleted agent ${params.agentId}`,
            state: { agentId: params.agentId, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to delete agent');
        }
      },

      duplicateAgent: async (params: DuplicateAgentParams): Promise<ToolExecutionResult> => {
        try {
          const result = await agentModel.duplicate(params.agentId, params.newTitle);
          if (!result) {
            return { content: `Agent "${params.agentId}" not found.`, success: false };
          }
          return {
            content: `Successfully duplicated agent. New agent ID: ${result.agentId}${params.newTitle ? ` with title "${params.newTitle}"` : ''}`,
            state: { newAgentId: result.agentId, sourceAgentId: params.agentId, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to duplicate agent');
        }
      },

      getAgentDetail: async (params: GetAgentDetailParams): Promise<ToolExecutionResult> => {
        try {
          const agent = await agentModel.getAgentConfigById(params.agentId);
          if (!agent) {
            return { content: `Agent "${params.agentId}" not found.`, success: false };
          }

          const detail = {
            config: {
              model: agent.model,
              openingMessage: agent.openingMessage,
              openingQuestions: agent.openingQuestions,
              plugins: agent.plugins,
              provider: agent.provider,
              systemRole: agent.systemRole,
            },
            meta: {
              avatar: agent.avatar,
              backgroundColor: agent.backgroundColor,
              description: agent.description,
              tags: agent.tags,
              title: agent.title,
            },
          };

          const parts: string[] = [];
          if (detail.meta.title) parts.push(`**${detail.meta.title}**`);
          if (detail.meta.description) parts.push(detail.meta.description);
          if (detail.config.model)
            parts.push(`Model: ${detail.config.provider || ''}/${detail.config.model}`);
          if (detail.config.plugins?.length)
            parts.push(`Plugins: ${detail.config.plugins.join(', ')}`);
          if (detail.config.systemRole) parts.push(`System Prompt: ${detail.config.systemRole}`);

          return {
            content: parts.length > 0 ? parts.join('\n') : `Agent "${params.agentId}" found.`,
            state: { agentId: params.agentId, ...detail, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to get agent detail');
        }
      },

      installPlugin: async (params: InstallPluginParams): Promise<ToolExecutionResult> => {
        try {
          const { agentId, identifier } = params;
          const agent = await agentModel.getAgentConfigById(agentId);
          if (!agent) {
            return { content: `Agent "${agentId}" not found.`, success: false };
          }

          // Ensure the plugin is registered in user_installed_plugins so that
          // PluginModel.query() can resolve its manifest during agent execution.
          const existing = await pluginModel.findById(identifier);
          if (!existing) {
            await pluginModel.create({ identifier, type: 'plugin' });
          }

          const currentPlugins = (agent.plugins as string[] | null) || [];
          if (!currentPlugins.includes(identifier)) {
            await agentModel.updateConfig(agentId, {
              plugins: [...currentPlugins, identifier],
            });
          }

          return {
            content: `Successfully enabled plugin "${identifier}" for agent "${agentId}"`,
            state: { installed: true, pluginId: identifier, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to install plugin');
        }
      },

      searchAgent: async (params: SearchAgentParams): Promise<ToolExecutionResult> => {
        try {
          const source = params.source || 'all';
          const limit = Math.min(params.limit || 10, 20);
          const results: Array<{
            avatar?: string | null;
            backgroundColor?: string | null;
            description?: string | null;
            id: string;
            isMarket?: boolean;
            title?: string | null;
          }> = [];

          if (source === 'user' || source === 'all') {
            const userAgents = await agentModel.queryAgents({ keyword: params.keyword, limit });
            results.push(...userAgents.map((a) => ({ ...a, isMarket: false })));
          }

          if (source === 'market' || source === 'all') {
            const marketResult = await discoverService.getAssistantList({
              pageSize: limit,
              q: params.keyword,
              ...(params.category && { category: params.category }),
            });
            results.push(
              ...marketResult.items.map((a) => ({
                avatar: a.avatar,
                backgroundColor: a.backgroundColor,
                description: a.description,
                id: a.identifier,
                isMarket: true,
                title: a.title,
              })),
            );
          }

          const sliced = results.slice(0, limit);
          const list = sliced
            .map((a) => `- ${a.title || 'Untitled'} (${a.id})${a.isMarket ? ' [Market]' : ''}`)
            .join('\n');

          return {
            content:
              sliced.length > 0
                ? `Found ${sliced.length} agents:\n${list}`
                : 'No agents found matching your search criteria.',
            state: {
              agents: sliced,
              keyword: params.keyword,
              source,
              totalCount: sliced.length,
            },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to search agents');
        }
      },

      updateAgent: async (params: UpdateAgentParams): Promise<ToolExecutionResult> => {
        try {
          const { agentId } = params;
          let { config, meta } = params;

          // Guard against LLM double-encoding: parse strings if needed
          if (typeof config === 'string') {
            try {
              config = JSON.parse(config as string);
            } catch {
              config = undefined;
            }
          }
          if (typeof meta === 'string') {
            try {
              meta = JSON.parse(meta as string);
            } catch {
              meta = undefined;
            }
          }

          const updatedParts: string[] = [];

          if (config && Object.keys(config).length > 0) {
            await agentModel.updateConfig(agentId, config as Record<string, unknown>);
            updatedParts.push(`config: ${Object.keys(config).join(', ')}`);
          }

          if (meta && Object.keys(meta).length > 0) {
            await agentModel.update(agentId, meta as Record<string, unknown>);
            updatedParts.push(`meta: ${Object.keys(meta).join(', ')}`);
          }

          if (updatedParts.length === 0) {
            return { content: 'No fields to update.', state: { success: true }, success: true };
          }

          return {
            content: `Successfully updated agent. Updated ${updatedParts.join('; ')}`,
            state: { agentId, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to update agent');
        }
      },

      updatePrompt: async (params: UpdatePromptParams): Promise<ToolExecutionResult> => {
        try {
          const { agentId, prompt } = params;
          await agentModel.update(agentId, { editorData: null, systemRole: prompt } as Record<
            string,
            unknown
          >);

          return {
            content: prompt
              ? `Successfully updated system prompt (${prompt.length} characters)`
              : 'Successfully cleared system prompt',
            state: { newPrompt: prompt, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to update prompt');
        }
      },
    };
  },
  identifier: AgentManagementIdentifier,
};
