import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { customAlphabet } from 'nanoid/non-secure';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { generateTrustedClientToken } from '@/libs/trusted-client';

const MARKET_BASE_URL = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';

interface MarketUserInfo {
  accountId: number;
  sub: string;
}

const log = debug('lambda-router:market:agent');

/**
 * Generate a market identifier (8-character lowercase alphanumeric string)
 * Format: [a-z0-9]{8}
 */
const generateMarketIdentifier = () => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const generate = customAlphabet(alphabet, 8);
  return generate();
};

interface FetchMarketUserInfoOptions {
  accessToken?: string;
  userInfo?: TrustedClientUserInfo;
}

/**
 * Fetch Market user info using either trustedClientToken or accessToken
 * Returns the Market accountId which is different from LobeChat userId
 *
 * Priority:
 * 1. trustedClientToken (if userInfo is provided and TRUSTED_CLIENT_SECRET is configured)
 * 2. accessToken (if provided, from OIDC flow)
 */
const fetchMarketUserInfo = async (
  options: FetchMarketUserInfoOptions,
): Promise<MarketUserInfo | null> => {
  const { userInfo, accessToken } = options;

  try {
    const userInfoUrl = `${MARKET_BASE_URL}/lobehub-oidc/userinfo`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Try trustedClientToken first (if userInfo is available)
    if (userInfo) {
      const trustedClientToken = generateTrustedClientToken(userInfo);
      if (trustedClientToken) {
        headers['x-lobe-trust-token'] = trustedClientToken;
        log('Using trustedClientToken for user info fetch');
      }
    }

    // Fall back to accessToken if no trustedClientToken
    if (!headers['x-lobe-trust-token'] && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      log('Using accessToken for user info fetch');
    }

    // If neither authentication method is available, return null
    if (!headers['x-lobe-trust-token'] && !headers['Authorization']) {
      log('No authentication method available for fetching user info');
      return null;
    }

    const response = await fetch(userInfoUrl, {
      headers,
      method: 'GET',
    });

    if (!response.ok) {
      log('Failed to fetch Market user info: %s %s', response.status, response.statusText);
      return null;
    }

    return (await response.json()) as MarketUserInfo;
  } catch (error) {
    log('Error fetching Market user info: %O', error);
    return null;
  }
};

// Authenticated procedure for agent management
// Requires user to be logged in and has MarketSDK initialized
// Also fetches user's market accessToken from database for OIDC authentication
const agentProcedure = authedProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(marketSDK)
  .use(async ({ ctx, next }) => {
    // Import UserModel dynamically to avoid circular dependencies
    const { UserModel } = await import('@/database/models/user');
    const userModel = new UserModel(ctx.serverDB, ctx.userId);

    // Get user's market accessToken from database (stored by MarketAuthProvider after OIDC login)
    let marketOidcAccessToken: string | undefined;
    try {
      const userState = await userModel.getUserState(async () => ({}));
      marketOidcAccessToken = userState.settings?.market?.accessToken;
      log('marketOidcAccessToken from DB exists=%s', !!marketOidcAccessToken);
    } catch (error) {
      log('Failed to get marketOidcAccessToken from DB: %O', error);
    }

    return next({
      ctx: {
        marketOidcAccessToken,
      },
    });
  });

// Schema definitions
const createAgentSchema = z.object({
  homepage: z.string().optional(),
  identifier: z.string(),
  isFeatured: z.boolean().optional(),
  name: z.string(),
  status: z.enum(['published', 'unpublished', 'archived', 'deprecated']).optional(),
  tokenUsage: z.number().optional(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
});

const createAgentVersionSchema = z.object({
  a2aProtocolVersion: z.string().optional(),
  avatar: z.string().optional(),
  category: z.string().optional(),
  changelog: z.string().optional(),
  config: z.record(z.any()).optional(),
  defaultInputModes: z.array(z.string()).optional(),
  defaultOutputModes: z.array(z.string()).optional(),
  description: z.string().optional(),
  documentationUrl: z.string().optional(),
  extensions: z.array(z.record(z.any())).optional(),
  hasPushNotifications: z.boolean().optional(),
  hasStateTransitionHistory: z.boolean().optional(),
  hasStreaming: z.boolean().optional(),
  identifier: z.string(),
  interfaces: z.array(z.record(z.any())).optional(),
  name: z.string().optional(),
  preferredTransport: z.string().optional(),
  providerId: z.number().optional(),
  securityRequirements: z.array(z.record(z.any())).optional(),
  securitySchemes: z.record(z.any()).optional(),
  setAsCurrent: z.boolean().optional(),
  summary: z.string().optional(),
  supportsAuthenticatedExtendedCard: z.boolean().optional(),
  tokenUsage: z.number().optional(),
  url: z.string().optional(),
});

const paginationSchema = z.object({
  page: z.number().optional(),
  pageSize: z.number().optional(),
});

// Schema for the unified publish/create flow
const publishOrCreateSchema = z.object({
  // Version data
  avatar: z.string().optional(),

  category: z.string().optional(),

  changelog: z.string().optional(),

  config: z.record(z.any()).optional(),

  description: z.string().optional(),

  editorData: z.record(z.any()).optional(),

  // Agent basic info
  identifier: z.string().nullish(),
  // Optional - if not provided or not owned, will create new (allow null or undefined)
  name: z.string(),
  tags: z.array(z.string()).optional(),
  tokenUsage: z.number().optional(),
});

export const agentRouter = router({
  /**
   * Check if current user owns the specified agent
   * Returns ownership status and original agent info for fork scenario
   */
  checkOwnership: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('checkOwnership input: %O', input);

      try {
        // Get agent detail
        const agentDetail = await ctx.marketSDK.agents.getAgentDetail(input.identifier);

        if (!agentDetail) {
          return {
            exists: false,
            isOwner: false,
            originalAgent: null,
          };
        }

        // Get Market user info to get accountId
        // Support both trustedClientToken and OIDC accessToken authentication
        const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
        const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;
        let currentAccountId: number | null = null;

        const marketUserInfoResult = await fetchMarketUserInfo({ accessToken, userInfo });
        currentAccountId = marketUserInfoResult?.accountId ?? null;

        const ownerId = agentDetail.ownerId;
        const isOwner = currentAccountId !== null && `${ownerId}` === `${currentAccountId}`;

        log(
          'checkOwnership result: isOwner=%s, currentAccountId=%s, ownerId=%s',
          isOwner,
          currentAccountId,
          ownerId,
        );

        return {
          exists: true,
          isOwner,
          originalAgent: isOwner
            ? null
            : {
                author: agentDetail.author,
                avatar: agentDetail.avatar,
                identifier: agentDetail.identifier,
                name: agentDetail.name,
              },
        };
      } catch (error) {
        log('Error checking ownership: %O', error);
        // If agent not found or error, treat as not existing
        return {
          exists: false,
          isOwner: false,
          originalAgent: null,
        };
      }
    }),

  /**
   * Create a new agent in the marketplace
   * POST /market/agent/create
   */
  createAgent: agentProcedure.input(createAgentSchema).mutation(async ({ input, ctx }) => {
    log('createAgent input: %O', input);

    try {
      const response = await ctx.marketSDK.agents.createAgent(input);
      return response;
    } catch (error) {
      log('Error creating agent: %O', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create agent',
      });
    }
  }),

  /**
   * Create a new version for an existing agent
   * POST /market/agent/versions/create
   */
  createAgentVersion: agentProcedure
    .input(createAgentVersionSchema)
    .mutation(async ({ input, ctx }) => {
      log('createAgentVersion input: %O', input);

      try {
        const response = await ctx.marketSDK.agents.createAgentVersion(input);
        return response;
      } catch (error) {
        log('Error creating agent version: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create agent version',
        });
      }
    }),

  /**
   * Deprecate an agent (permanently hide, cannot be republished)
   * POST /market/agent/:identifier/deprecate
   */
  deprecateAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('deprecateAgent input: %O', input);

      try {
        const response = await ctx.marketSDK.agents.deprecate(input.identifier);
        return response ?? { success: true };
      } catch (error) {
        log('Error deprecating agent: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to deprecate agent',
        });
      }
    }),

  /**
   * Fork an agent
   * POST /market/agent/:identifier/fork
   */
  forkAgent: agentProcedure
    .input(
      z.object({
        identifier: z.string(),
        name: z.string().optional(),
        sourceIdentifier: z.string(),
        status: z.enum(['published', 'unpublished', 'archived', 'deprecated']).optional(),
        versionNumber: z.number().optional(),
        visibility: z.enum(['public', 'private', 'internal']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('forkAgent input: %O', input);

      try {
        // Call Market API directly to fork agent
        const forkUrl = `${MARKET_BASE_URL}/api/v1/agents/${input.sourceIdentifier}/fork`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Use trustedClientToken or accessToken for authentication
        const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
        const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;

        if (userInfo) {
          const trustedClientToken = generateTrustedClientToken(userInfo);
          if (trustedClientToken) {
            headers['x-lobe-trust-token'] = trustedClientToken;
          }
        }

        if (!headers['x-lobe-trust-token'] && accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const response = await fetch(forkUrl, {
          body: JSON.stringify({
            identifier: input.identifier,
            name: input.name,
            status: input.status,
            versionNumber: input.versionNumber,
            visibility: input.visibility,
          }),
          headers,
          method: 'POST',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log('Fork agent failed: %s %s - %s', response.status, response.statusText, errorText);
          throw new Error(`Failed to fork agent: ${response.statusText}`);
        }

        const result = await response.json();
        log('Fork agent success: %O', result);
        return result;
      } catch (error) {
        log('Error forking agent: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fork agent',
        });
      }
    }),

  /**
   * Get agent detail by identifier
   * GET /market/agent/:identifier
   */
  getAgentDetail: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getAgentDetail input: %O', input);

      try {
        const response = await ctx.marketSDK.agents.getAgentDetail(input.identifier);
        return response;
      } catch (error) {
        log('Error getting agent detail: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get agent detail',
        });
      }
    }),

  /**
   * Get the fork source of an agent
   * GET /market/agent/:identifier/fork-source
   */
  getAgentForkSource: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getAgentForkSource input: %O', input);

      try {
        const forkSourceUrl = `${MARKET_BASE_URL}/api/v1/agents/${input.identifier}/fork-source`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
        const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;

        if (userInfo) {
          const trustedClientToken = generateTrustedClientToken(userInfo);
          if (trustedClientToken) {
            headers['x-lobe-trust-token'] = trustedClientToken;
          }
        }

        if (!headers['x-lobe-trust-token'] && accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const response = await fetch(forkSourceUrl, {
          headers,
          method: 'GET',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log(
            'Get agent fork source failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to get agent fork source: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      } catch (error) {
        log('Error getting agent fork source: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get agent fork source',
        });
      }
    }),

  /**
   * Get all forks of an agent
   * GET /market/agent/:identifier/forks
   */
  getAgentForks: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getAgentForks input: %O', input);

      try {
        const forksUrl = `${MARKET_BASE_URL}/api/v1/agents/${input.identifier}/forks`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
        const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;

        if (userInfo) {
          const trustedClientToken = generateTrustedClientToken(userInfo);
          if (trustedClientToken) {
            headers['x-lobe-trust-token'] = trustedClientToken;
          }
        }

        if (!headers['x-lobe-trust-token'] && accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const response = await fetch(forksUrl, {
          headers,
          method: 'GET',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log(
            'Get agent forks failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to get agent forks: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      } catch (error) {
        log('Error getting agent forks: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get agent forks',
        });
      }
    }),

  /**
   * Get own agents (requires authentication)
   * GET /market/agent/own
   */
  getOwnAgents: agentProcedure.input(paginationSchema.optional()).query(async ({ input, ctx }) => {
    log('getOwnAgents input: %O', input);

    try {
      const response = await ctx.marketSDK.agents.getOwnAgents({
        page: input?.page,
        pageSize: input?.pageSize,
      });
      return response;
    } catch (error) {
      log('Error getting own agents: %O', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get own agents',
      });
    }
  }),

  /**
   * Publish an agent (make it visible in marketplace)
   * POST /market/agent/:identifier/publish
   */
  publishAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('publishAgent input: %O', input);

      try {
        const response = await ctx.marketSDK.agents.publish(input.identifier);
        return response ?? { success: true };
      } catch (error) {
        log('Error publishing agent: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to publish agent',
        });
      }
    }),

  /**
   * Unified publish or create agent flow
   * This procedure handles the complete publish logic:
   * 1. Check if identifier exists and if current user is owner
   * 2. If not owner or no identifier, create new agent
   * 3. Create new version for the agent
   *
   * Returns: { identifier, isNewAgent, success }
   */
  publishOrCreate: agentProcedure.input(publishOrCreateSchema).mutation(async ({ input, ctx }) => {
    log('publishOrCreate input: %O', input);

    const { identifier: inputIdentifier, name, ...versionData } = input;
    let finalIdentifier = inputIdentifier;
    let isNewAgent = false;

    try {
      // Step 1: Check ownership if identifier is provided
      if (inputIdentifier) {
        try {
          const agentDetail = await ctx.marketSDK.agents.getAgentDetail(inputIdentifier);
          log('Agent detail for ownership check: ownerId=%s', agentDetail?.ownerId);

          // Get Market user info to get accountId (Market's user ID)
          // Support both trustedClientToken and OIDC accessToken authentication
          const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
          const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;
          let currentAccountId: number | null = null;

          const marketUserInfoResult = await fetchMarketUserInfo({ accessToken, userInfo });
          currentAccountId = marketUserInfoResult?.accountId ?? null;
          log('Market user info: accountId=%s', currentAccountId);

          const ownerId = agentDetail?.ownerId;

          log('Ownership check: currentAccountId=%s, ownerId=%s', currentAccountId, ownerId);

          if (!currentAccountId || `${ownerId}` !== `${currentAccountId}`) {
            // Not the owner, need to create a new agent
            log('User is not owner, will create new agent');
            finalIdentifier = undefined;
            isNewAgent = true;
          }
        } catch (detailError) {
          // Agent not found or error, create new
          log('Agent not found or error, will create new: %O', detailError);
          finalIdentifier = undefined;
          isNewAgent = true;
        }
      } else {
        isNewAgent = true;
      }

      // Step 2: Create new agent if needed
      if (!finalIdentifier) {
        // Generate a unique 8-character identifier
        finalIdentifier = generateMarketIdentifier();
        isNewAgent = true;

        log('Creating new agent with identifier: %s', finalIdentifier);

        await ctx.marketSDK.agents.createAgent({
          identifier: finalIdentifier,
          name,
        });
      }

      // Step 3: Create version for the agent
      log('Creating version for agent: %s', finalIdentifier);

      await ctx.marketSDK.agents.createAgentVersion({
        ...versionData,
        identifier: finalIdentifier,
        name,
      });

      return {
        identifier: finalIdentifier,
        isNewAgent,
        success: true,
      };
    } catch (error) {
      log('Error in publishOrCreate: %O', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to publish agent',
      });
    }
  }),

  /**
   * Unpublish an agent (hide from marketplace, can be republished)
   * POST /market/agent/:identifier/unpublish
   */
  unpublishAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('unpublishAgent input: %O', input);

      try {
        const response = await ctx.marketSDK.agents.unpublish(input.identifier);
        return response ?? { success: true };
      } catch (error) {
        log('Error unpublishing agent: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to unpublish agent',
        });
      }
    }),
});

export type AgentRouter = typeof agentRouter;
