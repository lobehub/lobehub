import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import {
  AssistantSorts,
  McpConnectionType,
  McpSorts,
  ModelSorts,
  PluginSorts,
  ProviderSorts,
} from '@/types/discover';

import { mapMarketError } from './marketError';
import { marketProcedure } from './procedures';

const log = debug('lambda-router:market');

const marketSourceSchema = z.enum(['legacy', 'new']);

export const discoveryProcedures = {
  getAgentsByPlugin: marketProcedure
    .input(
      z.object({
        locale: z.string().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
        pluginId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getAgentsByPlugin input: %O', input);

      try {
        return await ctx.discoverService.getAgentsByPlugin(input);
      } catch (error) {
        log('Error fetching agents by plugin: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch agents by plugin',
        });
      }
    }),
  // ============================== Assistant Market ==============================
  getAssistantCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
          source: marketSourceSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('  getAssistantCategories: marketProcedure\n input: %O', input);

      try {
        return await ctx.discoverService.getAssistantCategories(input);
      } catch (error) {
        log('Error fetching assistant categories: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch assistant categories',
        });
      }
    }),
  getAssistantDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        source: marketSourceSchema.optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getAssistantDetail input: %O', input);

      try {
        return await ctx.discoverService.getAssistantDetail(input);
      } catch (error) {
        log('Error fetching assistants detail: %O', error);
        throw mapMarketError(error, 'Failed to fetch assistants detail');
      }
    }),
  getAssistantIdentifiers: marketProcedure
    .input(
      z
        .object({
          source: marketSourceSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getAssistantIdentifiers called with input: %O', input);

      try {
        return await ctx.discoverService.getAssistantIdentifiers(input);
      } catch (error) {
        log('Error fetching assistant identifiers: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch assistant identifiers',
        });
      }
    }),
  getAssistantList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          connectionType: z.nativeEnum(McpConnectionType).optional(),
          includeAgentGroup: z.boolean().optional(),
          includeCategoryCounts: z.boolean().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          ownerId: z.string().optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(AssistantSorts).optional(),
          source: marketSourceSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getAssistantList input: %O', input);

      try {
        return await ctx.discoverService.getAssistantList(input);
      } catch (error) {
        log('Error fetching assistant list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch assistant list',
        });
      }
    }),
  // ============================== Group Agent Market (Discovery) ==============================
  getGroupAgentCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getGroupAgentCategories input: %O', input);

      try {
        return await ctx.discoverService.getGroupAgentCategories(input);
      } catch (error) {
        log('Error fetching group agent categories: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch group agent categories',
        });
      }
    }),
  getGroupAgentDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getGroupAgentDetail input: %O', input);

      try {
        return await ctx.discoverService.getGroupAgentDetail(input);
      } catch (error) {
        log('Error fetching group agent detail: %O', error);
        throw mapMarketError(error, 'Failed to fetch group agent detail');
      }
    }),
  getGroupAgentIdentifiers: marketProcedure.query(async ({ ctx }) => {
    log('getGroupAgentIdentifiers called');

    try {
      return await ctx.discoverService.getGroupAgentIdentifiers();
    } catch (error) {
      log('Error fetching group agent identifiers: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch group agent identifiers',
      });
    }
  }),
  getGroupAgentList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          ownerId: z.string().optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.enum(['createdAt', 'updatedAt', 'name', 'recommended']).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getGroupAgentList input: %O', input);

      try {
        return await ctx.discoverService.getGroupAgentList(input);
      } catch (error) {
        log('Error fetching group agent list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch group agent list',
        });
      }
    }),
  getLegacyPluginList: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getLegacyPluginList input: %O', input);
      try {
        return await ctx.discoverService.getLegacyPluginList(input);
      } catch (error) {
        log('Error fetching legacy plugin list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch plugin list',
        });
      }
    }),
  // ============================== MCP Market ==============================
  getMcpCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpCategories input: %O', input);

      try {
        return await ctx.discoverService.getMcpCategories(input);
      } catch (error) {
        log('Error fetching mcp categories: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch mcp categories',
        });
      }
    }),
  getMcpDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpDetail input: %O', input);

      try {
        return await ctx.discoverService.getMcpDetail(input);
      } catch (error) {
        console.error('Error fetching mcp detail: %O', error);
        throw mapMarketError(error, 'Failed to fetch mcp detail');
      }
    }),
  getMcpList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          connectionType: z.nativeEnum(McpConnectionType).optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(McpSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpList input: %O', input);

      try {
        return await ctx.discoverService.getMcpList(input);
      } catch (error) {
        log('Error fetching mcp list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch mcp list',
        });
      }
    }),
  getMcpManifest: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        install: z.boolean().optional(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpManifest input: %O', input);

      try {
        return await ctx.discoverService.getMcpManifest(input);
      } catch (error) {
        log('Error fetching mcp manifest: %O', error);
        throw mapMarketError(error, 'Failed to fetch mcp manifest');
      }
    }),
  // ============================== Models ==============================
  getModelCategories: marketProcedure
    .input(
      z
        .object({
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getModelCategories input: %O', input);

      try {
        return await ctx.discoverService.getModelCategories(input);
      } catch (error) {
        log('Error fetching model categories: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch model categories',
        });
      }
    }),
  getModelDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getModelDetail input: %O', input);

      try {
        return await ctx.discoverService.getModelDetail(input);
      } catch (error) {
        log('Error fetching model details: %O', error);
        throw mapMarketError(error, 'Failed to fetch model details');
      }
    }),
  getModelIdentifiers: marketProcedure.query(async ({ ctx }) => {
    log('getModelIdentifiers called');

    try {
      return await ctx.discoverService.getModelIdentifiers();
    } catch (error) {
      log('Error fetching model identifiers: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch model identifiers',
      });
    }
  }),
  getModelList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(ModelSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getModelList input: %O', input);

      try {
        return await ctx.discoverService.getModelList(input);
      } catch (error) {
        log('Error fetching model list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch model list',
        });
      }
    }),
  // ============================== Plugin Market ==============================
  getPluginCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getPluginCategories input: %O', input);

      try {
        return await ctx.discoverService.getPluginCategories(input);
      } catch (error) {
        log('Error fetching plugin categories: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch plugin categories',
        });
      }
    }),
  getPluginDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        withManifest: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getPluginDetail input: %O', input);

      try {
        return await ctx.discoverService.getPluginDetail(input);
      } catch (error) {
        log('Error fetching plugin details: %O', error);
        throw mapMarketError(error, 'Failed to fetch plugin details');
      }
    }),
  getPluginIdentifiers: marketProcedure.query(async ({ ctx }) => {
    log('getPluginIdentifiers called');

    try {
      return await ctx.discoverService.getPluginIdentifiers();
    } catch (error) {
      log('Error fetching plugin identifiers: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch plugin identifiers',
      });
    }
  }),
  getPluginList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(PluginSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getPluginList input: %O', input);

      try {
        return await ctx.discoverService.getPluginList(input);
      } catch (error) {
        log('Error fetching plugin list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch plugin list',
        });
      }
    }),
  // ============================== Providers ==============================
  getProviderDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        withReadme: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getProviderDetail input: %O', input);

      try {
        return await ctx.discoverService.getProviderDetail(input);
      } catch (error) {
        log('Error fetching provider details: %O', error);
        throw mapMarketError(error, 'Failed to fetch provider details');
      }
    }),
  getProviderIdentifiers: marketProcedure.query(async ({ ctx }) => {
    log('getProviderIdentifiers called');

    try {
      return await ctx.discoverService.getProviderIdentifiers();
    } catch (error) {
      log('Error fetching provider identifiers: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch provider identifiers',
      });
    }
  }),
  getProviderList: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(ProviderSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getProviderList input: %O', input);

      try {
        return await ctx.discoverService.getProviderList(input);
      } catch (error) {
        log('Error fetching provider list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch provider list',
        });
      }
    }),
  // ============================== User Profile ==============================
  getUserInfo: marketProcedure
    .input(
      z.object({
        locale: z.string().optional(),
        username: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getUserInfo input: %O', input);

      try {
        return await ctx.discoverService.getUserInfo(input);
      } catch (error) {
        log('Error fetching user info: %O', error);
        throw mapMarketError(error, 'Failed to fetch user info');
      }
    }),
};
