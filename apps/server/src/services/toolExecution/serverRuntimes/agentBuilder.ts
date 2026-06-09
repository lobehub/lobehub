import {
  AgentBuilderIdentifier,
  type GetAvailableModelsParams,
  type InstallPluginParams,
  type SearchMarketToolsParams,
  type UpdateAgentConfigParams,
  type UpdatePromptParams,
} from '@lobechat/builtin-tool-agent-builder';
import { builtinTools } from '@lobechat/builtin-tools';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { modelsResultsPrompt } from '@lobechat/prompts';

import { AgentModel } from '@/database/models/agent';
import { PluginModel } from '@/database/models/plugin';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { DiscoverService } from '@/server/services/discover';

import { type ToolExecutionContext, type ToolExecutionResult } from '../types';
import { type ServerRuntimeRegistration } from './types';

const MAX_MODELS = 20;

const handleError = (error: unknown, message: string): ToolExecutionResult => {
  const err = error as Error;
  return { content: `${message}: ${err.message}`, success: false };
};

export const agentBuilderRuntime: ServerRuntimeRegistration = {
  factory: (context: ToolExecutionContext) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Builder execution');
    }

    const agentModel = new AgentModel(context.serverDB, context.userId, context.workspaceId);
    const pluginModel = new PluginModel(context.serverDB, context.userId, context.workspaceId);
    const aiInfraRepos = new AiInfraRepos(context.serverDB, context.userId, {});
    const discoverService = new DiscoverService();

    return {
      getAvailableModels: async (
        params: GetAvailableModelsParams,
      ): Promise<ToolExecutionResult> => {
        try {
          const allProviders = await aiInfraRepos.getAiProviderList();
          const enabledProviders = allProviders.filter((p) => p.enabled);

          // LobeHub provider first, then by sort order
          enabledProviders.sort((a, b) => {
            if (a.id === BRANDING_PROVIDER) return -1;
            if (b.id === BRANDING_PROVIDER) return 1;
            return (a.sort ?? 999) - (b.sort ?? 999);
          });

          // Apply optional provider filter
          const filteredProviders = params.providerId
            ? enabledProviders.filter((p) => p.id === params.providerId)
            : enabledProviders;

          const providerResults: Array<{
            id: string;
            models: Array<{
              abilities?: {
                files?: boolean;
                functionCall?: boolean;
                reasoning?: boolean;
                vision?: boolean;
              };
              description?: string;
              id: string;
              name: string;
            }>;
            name: string;
          }> = [];

          let totalModels = 0;

          for (const provider of filteredProviders) {
            if (totalModels >= MAX_MODELS) break;

            const enabledChatModels = await aiInfraRepos.getAiProviderModelList(provider.id, {
              enabled: true,
              type: 'chat',
            });

            const remaining = MAX_MODELS - totalModels;
            const sliced = enabledChatModels.slice(0, remaining);

            if (sliced.length === 0) continue;

            providerResults.push({
              id: provider.id,
              models: sliced.map((m) => ({
                abilities: (m.abilities as any) ?? undefined,
                id: m.id,
                name: m.displayName || m.id,
              })),
              name: provider.name || provider.id,
            });

            totalModels += sliced.length;
          }

          const xmlContent = modelsResultsPrompt(providerResults);
          const summary = `Found ${providerResults.length} enabled provider(s) with ${totalModels} model(s).\n\n${xmlContent}`;

          return {
            content: summary,
            state: { providers: providerResults },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to get available models');
        }
      },

      searchMarketTools: async (params: SearchMarketToolsParams): Promise<ToolExecutionResult> => {
        try {
          const response = await discoverService.getMcpList({
            category: params.category,
            pageSize: params.pageSize || 10,
            q: params.query,
          });

          const tools = response.items.map((item) => ({
            author: item.author,
            description: item.description,
            identifier: item.identifier,
            name: item.name,
            tags: item.tags,
          }));

          let summary = `Found ${response.totalCount} tool(s) in the marketplace.`;
          if (params.query) {
            summary = `Found ${response.totalCount} tool(s) matching "${params.query}".`;
          }

          const toolLines = tools
            .map((t) => `- ${t.name} (${t.identifier})${t.description ? ': ' + t.description : ''}`)
            .join('\n');

          return {
            content: `${summary}\n\n${toolLines}`,
            state: { query: params.query, tools, totalCount: response.totalCount },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to search market tools');
        }
      },

      updateConfig: async (
        params: UpdateAgentConfigParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const agentId = ctx.agentId;

        if (!agentId) {
          return {
            content: 'No active agent found',
            error: { message: 'No active agent found', type: 'NoAgentContext' },
            success: false,
          };
        }

        try {
          const agent = await agentModel.getAgentConfigById(agentId);
          if (!agent) {
            return { content: `Agent "${agentId}" not found.`, success: false };
          }

          let rawConfig: any = params.config;
          if (typeof rawConfig === 'string') {
            try {
              rawConfig = JSON.parse(rawConfig);
            } catch {
              rawConfig = undefined;
            }
          }
          let rawMeta: any = params.meta;
          if (typeof rawMeta === 'string') {
            try {
              rawMeta = JSON.parse(rawMeta);
            } catch {
              rawMeta = undefined;
            }
          }

          let finalConfig = rawConfig ? { ...rawConfig } : {};
          const updatedParts: string[] = [];

          if (params.togglePlugin) {
            const { pluginId, enabled } = params.togglePlugin;
            const currentPlugins = (agent.plugins as string[] | null) || [];
            const isEnabled = currentPlugins.includes(pluginId);
            const shouldEnable = enabled !== undefined ? enabled : !isEnabled;

            const newPlugins =
              shouldEnable && !isEnabled
                ? [...currentPlugins, pluginId]
                : !shouldEnable && isEnabled
                  ? currentPlugins.filter((id: string) => id !== pluginId)
                  : currentPlugins;

            finalConfig = { ...finalConfig, plugins: newPlugins };
            updatedParts.push(`plugin ${pluginId} ${shouldEnable ? 'enabled' : 'disabled'}`);
          }

          if ('systemRole' in finalConfig && !('editorData' in finalConfig)) {
            finalConfig = { ...finalConfig, editorData: null };
          }

          if (Object.keys(finalConfig).length > 0) {
            await agentModel.updateConfig(agentId, finalConfig);
            const nonPluginFields = Object.keys(finalConfig).filter((f) => f !== 'plugins');
            if (nonPluginFields.length > 0) {
              updatedParts.push(`config fields: ${nonPluginFields.join(', ')}`);
            }
          }

          if (rawMeta && Object.keys(rawMeta).length > 0) {
            await agentModel.update(agentId, rawMeta as Record<string, unknown>);
            updatedParts.push(`meta fields: ${Object.keys(rawMeta).join(', ')}`);
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
          return handleError(error, 'Failed to update agent config');
        }
      },

      updatePrompt: async (
        params: UpdatePromptParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const agentId = ctx.agentId;

        if (!agentId) {
          return {
            content: 'No active agent found',
            error: { message: 'No active agent found', type: 'NoAgentContext' },
            success: false,
          };
        }

        try {
          await agentModel.update(agentId, {
            editorData: null,
            systemRole: params.prompt,
          } as Record<string, unknown>);

          return {
            content: params.prompt
              ? `Successfully updated system prompt (${params.prompt.length} characters)`
              : 'Successfully cleared system prompt',
            state: { newPrompt: params.prompt, success: true },
            success: true,
          };
        } catch (error) {
          return handleError(error, 'Failed to update prompt');
        }
      },

      installPlugin: async (
        params: InstallPluginParams,
        ctx: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const agentId = ctx.agentId;

        if (!agentId) {
          return {
            content: 'No active agent found',
            error: { message: 'No active agent found', type: 'NoAgentContext' },
            success: false,
          };
        }

        const { identifier, source } = params;

        if (source === 'official') {
          if (builtinTools.some((t) => t.identifier === identifier)) {
            // Builtin tools (lobe-web-browsing, lobe-image-generation, etc.) need no OAuth
            try {
              const agent = await agentModel.getAgentConfigById(agentId);
              if (!agent) return { content: `Agent "${agentId}" not found.`, success: false };

              const currentPlugins = (agent.plugins as string[] | null) || [];
              if (!currentPlugins.includes(identifier)) {
                await agentModel.updateConfig(agentId, {
                  plugins: [...currentPlugins, identifier],
                });
              }
              return {
                content: `Successfully enabled "${identifier}" for agent "${agentId}"`,
                state: { installed: true, pluginId: identifier, success: true },
                success: true,
              };
            } catch (error) {
              return handleError(error, 'Failed to enable builtin tool');
            }
          }

          // OAuth-based tools (Klavis, LobehubSkill) cannot be installed in background context
          return {
            content: `Installing official integrations that require OAuth (Klavis, LobehubSkill) is not supported in background execution. Please install "${identifier}" from the Agent Builder UI instead.`,
            error: { message: 'OAuth not available in background context', type: 'NotSupported' },
            success: false,
          };
        }

        // source === 'market' — MCP marketplace plugin
        try {
          const agent = await agentModel.getAgentConfigById(agentId);
          if (!agent) {
            return { content: `Agent "${agentId}" not found.`, success: false };
          }

          const existing = await pluginModel.findById(identifier);
          if (!existing) {
            let manifest: any;
            try {
              manifest = await discoverService.getMcpManifest({ identifier });
            } catch {
              // proceed without manifest if fetch fails; tool will be unusable until manifest loads
            }
            await pluginModel.create({ identifier, manifest: manifest as any, type: 'plugin' });
          } else if (!existing.manifest) {
            try {
              const manifest = await discoverService.getMcpManifest({ identifier });
              await pluginModel.update(identifier, { manifest: manifest as any });
            } catch {
              // best-effort backfill
            }
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
    };
  },
  identifier: AgentBuilderIdentifier,
};
