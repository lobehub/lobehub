import type { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { z } from 'zod';

import { PluginModel } from '@/database/models/plugin';
import { getKlavisClient } from '@/libs/klavis';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * Klavis procedure with API key validation and database access
 */
const klavisProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const client = getKlavisClient();
  const pluginModel = new PluginModel(opts.ctx.serverDB, opts.ctx.userId);

  return opts.next({
    ctx: { ...opts.ctx, klavisClient: client, pluginModel },
  });
});

export const klavisRouter = router({
  /**
   * Create a single MCP server instance and save to database
   * Returns: { serverUrl, instanceId, oauthUrl?, identifier, serverName }
   */
  createServerInstance: klavisProcedure
    .input(
      z.object({
        /** Identifier for storage (e.g., 'google-calendar') */
        identifier: z.string(),
        /** Server name for Klavis API (e.g., 'Google Calendar') */
        serverName: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { serverName, userId, identifier } = input;

      // 创建单个服务器实例
      const response = await ctx.klavisClient.mcpServer.createServerInstance({
        serverName: serverName as any,
        userId,
      });

      const { serverUrl, instanceId, oauthUrl } = response;

      // 获取该服务器的工具列表
      const toolsResponse = await ctx.klavisClient.mcpServer.getTools(serverName as any);
      const tools = toolsResponse.tools || [];

      // 保存到数据库，使用传入的 identifier（格式：小写，空格替换为连字符）
      const manifest: LobeChatPluginManifest = {
        api: tools.map((tool: any) => ({
          description: tool.description || '',
          name: tool.name,
          parameters: tool.inputSchema || { properties: {}, type: 'object' },
        })),
        identifier,
        meta: {
          avatar: '🔌',
          description: `LobeHub Mcp Server: ${serverName}`,
          title: serverName,
        },
        type: 'default',
      };

      // 保存到数据库，包含 oauthUrl 和 isAuthenticated 状态
      const isAuthenticated = !oauthUrl; // 如果没有 oauthUrl，说明不需要认证或已认证
      await ctx.pluginModel.create({
        customParams: {
          klavis: {
            instanceId,
            isAuthenticated,
            oauthUrl,
            serverName,
            serverUrl,
          },
        },
        identifier,
        manifest,
        source: 'klavis',
        type: 'plugin',
      });

      return {
        identifier,
        instanceId,
        isAuthenticated,
        oauthUrl,
        serverName,
        serverUrl,
      };
    }),

  /**
   * Delete a server instance
   */
  deleteServerInstance: klavisProcedure
    .input(
      z.object({
        /** Identifier for storage (e.g., 'google-calendar') */
        identifier: z.string(),
        instanceId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // 调用 Klavis API 删除服务器实例
      await ctx.klavisClient.mcpServer.deleteServerInstance(input.instanceId);

      // 从数据库删除（使用 identifier）
      await ctx.pluginModel.delete(input.identifier);

      return { success: true };
    }),

  /**
   * Get Klavis plugins from database
   */
  getKlavisPlugins: klavisProcedure.query(async ({ ctx }) => {
    const allPlugins = await ctx.pluginModel.query();
    // Filter plugins that have klavis customParams
    return allPlugins.filter((plugin) => plugin.customParams?.klavis);
  }),

  /**
   * Get server instance status from Klavis API
   */
  getServerInstance: klavisProcedure
    .input(
      z.object({
        instanceId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const response = await ctx.klavisClient.mcpServer.getServerInstance(input.instanceId);
      return {
        authNeeded: response.authNeeded,
        externalUserId: response.externalUserId,
        instanceId: response.instanceId,
        isAuthenticated: response.isAuthenticated,
        oauthUrl: response.oauthUrl,
        platform: response.platform,
        serverName: response.serverName,
      };
    }),

  getUserIntergrations: klavisProcedure
    .input(
      z.object({
        userId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const response = await ctx.klavisClient.user.getUserIntegrations(input.userId);

      return {
        integrations: response.integrations,
      };
    }),

  /**
   * Remove Klavis plugin from database by identifier
   */
  removeKlavisPlugin: klavisProcedure
    .input(
      z.object({
        /** Identifier for storage (e.g., 'google-calendar') */
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.pluginModel.delete(input.identifier);
      return { success: true };
    }),

  /**
   * Update Klavis plugin with tools and auth status in database
   */
  updateKlavisPlugin: klavisProcedure
    .input(
      z.object({
        /** Identifier for storage (e.g., 'google-calendar') */
        identifier: z.string(),
        instanceId: z.string(),
        isAuthenticated: z.boolean(),
        oauthUrl: z.string().optional(),
        /** Server name for Klavis API (e.g., 'Google Calendar') */
        serverName: z.string(),
        serverUrl: z.string(),
        tools: z.array(
          z.object({
            description: z.string().optional(),
            inputSchema: z.any().optional(),
            name: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { identifier, serverName, serverUrl, instanceId, tools, isAuthenticated, oauthUrl } =
        input;

      // 获取现有插件（使用 identifier）
      const existingPlugin = await ctx.pluginModel.findById(identifier);

      // 构建包含所有工具的 manifest
      const manifest: LobeChatPluginManifest = {
        api: tools.map((tool) => ({
          description: tool.description || '',
          name: tool.name,
          parameters: tool.inputSchema || { properties: {}, type: 'object' },
        })),
        identifier,
        meta: existingPlugin?.manifest?.meta || {
          avatar: '🔌',
          description: `LobeHub Mcp Server: ${serverName}`,
          title: serverName,
        },
        type: 'default',
      };

      const customParams = {
        klavis: {
          instanceId,
          isAuthenticated,
          oauthUrl,
          serverName,
          serverUrl,
        },
      };

      // 更新或创建插件
      if (existingPlugin) {
        await ctx.pluginModel.update(identifier, { customParams, manifest });
      } else {
        await ctx.pluginModel.create({
          customParams,
          identifier,
          manifest,
          source: 'klavis',
          type: 'plugin',
        });
      }

      return { savedCount: tools.length };
    }),
});

export type KlavisRouter = typeof klavisRouter;
