import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
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

      // Create a single server instance
      const response = await ctx.klavisClient.mcpServer.createServerInstance({
        serverName: serverName as any,
        userId,
      });

      const { serverUrl, instanceId, oauthUrl } = response;

      // Get the tool list for this server
      const toolsResponse = await ctx.klavisClient.mcpServer.getTools(serverName as any);
      const tools = toolsResponse.tools || [];

      // Save to database using the provided identifier (format: lowercase, spaces replaced with hyphens)
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

      // Save to database with oauthUrl and isAuthenticated status
      const isAuthenticated = !oauthUrl; // If there's no oauthUrl, authentication is not required or already authenticated
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
      // Call Klavis API to delete server instance
      await ctx.klavisClient.mcpServer.deleteServerInstance(input.instanceId);

      // Delete from database (using identifier)
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
   * Returns error object instead of throwing on auth errors (useful for polling)
   */
  getServerInstance: klavisProcedure
    .input(
      z.object({
        instanceId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const response = await ctx.klavisClient.mcpServer.getServerInstance(input.instanceId);
        return {
          authNeeded: response.authNeeded,
          error: undefined,
          externalUserId: response.externalUserId,
          instanceId: response.instanceId,
          isAuthenticated: response.isAuthenticated,
          oauthUrl: response.oauthUrl,
          platform: response.platform,
          serverName: response.serverName,
        };
      } catch (error) {
        // Check if this is an authentication error
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isAuthError =
          errorMessage.includes('Invalid API key or instance ID') ||
          errorMessage.includes('Status code: 401');

        // For auth errors, return error object instead of throwing
        // This prevents 500 errors in logs during polling
        if (isAuthError) {
          return {
            authNeeded: true,
            error: 'AUTH_ERROR',
            externalUserId: undefined,
            instanceId: input.instanceId,
            isAuthenticated: false,
            oauthUrl: undefined,
            platform: undefined,
            serverName: undefined,
          };
        }

        // For other errors, still throw
        throw error;
      }
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

      // Get existing plugin (using identifier)
      const existingPlugin = await ctx.pluginModel.findById(identifier);

      // Build manifest containing all tools
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

      // Update or create plugin
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
