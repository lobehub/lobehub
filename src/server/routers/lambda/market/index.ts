import { isDesktop } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { serialize } from 'cookie';
import debug from 'debug';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DiscoverService } from '@/server/services/discover';
import { MarketService } from '@/server/services/market';
import {
  AssistantSorts,
  McpConnectionType,
  McpSorts,
  ModelSorts,
  PluginSorts,
  ProviderSorts,
} from '@/types/discover';

import { agentRouter } from './agent';
import { agentGroupRouter } from './agentGroup';
import { oidcRouter } from './oidc';
import { socialRouter } from './social';
import { userRouter } from './user';

const log = debug('lambda-router:market');

const marketSourceSchema = z.enum(['legacy', 'new']);

// Public procedure with optional user info for trusted client token
const marketProcedure = publicProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    return next({
      ctx: {
        discoverService: new DiscoverService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
        marketService: new MarketService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
      },
    });
  });

export const marketRouter = router({
  // ============================== Agent Management (authenticated) ==============================
  agent: agentRouter,

  // ============================== Agent Group Management (authenticated) ==============================
  agentGroup: agentGroupRouter,

  
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch assistants detail',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch group agent detail',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch mcp detail',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch mcp manifest',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch model details',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch plugin details',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch provider details',
        });
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch user info',
        });
      }
    }),

  // ============================== OIDC Authentication ==============================
  oidc: oidcRouter,

  registerClientInMarketplace: marketProcedure.input(z.object({})).mutation(async ({ ctx }) => {
    return ctx.discoverService.registerClient({
      userAgent: ctx.userAgent,
    });
  }),

  registerM2MToken: marketProcedure
    .input(
      z.object({
        clientId: z.string(),
        clientSecret: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('registerM2MToken input: %O', { clientId: input.clientId, clientSecret: '[HIDDEN]' });

      try {
        const { accessToken, expiresIn } = await ctx.discoverService.fetchM2MToken(input);

        // check accessToken
        if (!accessToken) {
          // clean Cookies

          ctx.resHeaders?.append('Set-Cookie', serialize('mp_token_status', '', { maxAge: -1 }));
          ctx.resHeaders?.append('Set-Cookie', serialize('mp_token', '', { maxAge: -1 }));

          return { success: false };
        }

        log('get access token, expiresIn value:', expiresIn);
        log('expiresIn type:', typeof expiresIn);

        const expirationTime = new Date(Date.now() + (expiresIn - 60) * 1000); // Expire 60 seconds early

        log('expirationTime:', expirationTime.toISOString());

        // Set HTTP-Only Cookie to store the actual access token
        const tokenCookie = serialize('mp_token', accessToken, {
          expires: expirationTime,
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });

        // Set client-readable status marker cookie (without actual token)
        const statusCookie = serialize('mp_token_status', 'active', {
          expires: expirationTime,
          httpOnly: false,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });

        // Set Set-Cookie header via context's resHeaders
        ctx.resHeaders?.append('Set-Cookie', tokenCookie);
        ctx.resHeaders?.append('Set-Cookie', statusCookie);

        return {
          expiresIn: expiresIn - 60,
          success: true,
        };
      } catch (error) {
        console.error('Error fetching M2M token: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch M2M token',
        });
      }
    }),

  reportAgentEvent: marketProcedure
    .input(
      z.object({
        event: z.enum(['add', 'chat', 'click']),
        identifier: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('createAgentEvent input: %O', input);

      try {
        await ctx.discoverService.createAgentEvent(input);
        return { success: true };
      } catch (error) {
        console.error('Error reporting Agent event: %O', error);
        return { success: false };
      }
    }),

  reportAgentInstall: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportAgentInstall input: %O', input);
      try {
        await ctx.discoverService.increaseAgentInstallCount(input.identifier);
        return { success: true };
      } catch (error) {
        log('Error reporting agent installation: %O', error);
        return { success: false };
      }
    }),

  // ============================== Analytics ==============================
  reportCall: marketProcedure
    .input(
      z.object({
        callDurationMs: z.number(),
        clientId: z.string().optional(),
        customPluginInfo: z.any().optional(),
        errorCode: z.string().optional(),
        errorMessage: z.string().optional(),
        identifier: z.string(),
        isCustomPlugin: z.boolean().optional(),
        metadata: z.record(z.any()).optional(),
        methodName: z.string(),
        methodType: z.enum(['tool', 'prompt', 'resource']),
        platform: z.string().optional(),
        requestSizeBytes: z.number().optional(),
        responseSizeBytes: z.number().optional(),
        sessionId: z.string().optional(),
        success: z.boolean(),
        traceId: z.string().optional(),
        userAgent: z.string().optional(),
        version: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportCall input: %O', input);
      try {
        await ctx.discoverService.reportCall({
          ...input,
          platform: isDesktop ? process.platform : 'web',
          userAgent: ctx.userAgent,
        });
        return { success: true };
      } catch (error) {
        console.error('Error reporting call: %O', error);
        // Don't throw error, as reporting failure should not affect main flow
        return { success: false };
      }
    }),

  reportGroupAgentEvent: marketProcedure
    .input(
      z.object({
        event: z.enum(['add', 'chat', 'click']),
        identifier: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportGroupAgentEvent input: %O', input);

      try {
        await ctx.discoverService.createGroupAgentEvent(input);
        return { success: true };
      } catch (error) {
        console.error('Error reporting Group Agent event: %O', error);
        return { success: false };
      }
    }),

  reportGroupAgentInstall: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportGroupAgentInstall input: %O', input);
      try {
        await ctx.discoverService.increaseGroupAgentInstallCount(input.identifier);
        return { success: true };
      } catch (error) {
        log('Error reporting group agent installation: %O', error);
        return { success: false };
      }
    }),

  reportMcpEvent: marketProcedure
    .input(
      z.object({
        event: z.enum(['click', 'install', 'activate', 'uninstall']),
        identifier: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('createMcpEvent input: %O', input);

      try {
        await ctx.discoverService.createPluginEvent(input);
        return { success: true };
      } catch (error) {
        console.error('Error reporting MCP event: %O', error);
        return { success: false };
      }
    }),

  reportMcpInstallResult: marketProcedure
    .input(
      z.object({
        errorCode: z.any().optional(),
        errorMessage: z.any().optional(),
        identifier: z.string(),
        installDurationMs: z.number().optional(),
        installParams: z.any().optional(),
        manifest: z.any().optional(),
        metadata: z.any().optional(),
        platform: z.string().optional(),
        success: z.boolean(),
        userAgent: z.string().optional(),
        version: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportMcpInstallResult input: %O', input);
      try {
        await ctx.discoverService.reportPluginInstallation(input);
        return { success: true };
      } catch (error) {
        log('Error reporting MCP installation result: %O', error);
        // Don't throw error, as reporting failure should not affect main flow
        return { success: false };
      }
    }),

  // ============================== Social Features ==============================
  social: socialRouter,

  // ============================== User Profile ==============================
  user: userRouter,
});
