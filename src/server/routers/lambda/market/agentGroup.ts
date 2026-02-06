import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { customAlphabet } from 'nanoid/non-secure';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type TrustedClientUserInfo, generateTrustedClientToken } from '@/libs/trusted-client';

const MARKET_BASE_URL = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';

interface MarketUserInfo {
  accountId: number;
  sub: string;
}

const log = debug('lambda-router:market:agent-group');

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

    if (userInfo) {
      const trustedClientToken = generateTrustedClientToken(userInfo);
      if (trustedClientToken) {
        headers['x-lobe-trust-token'] = trustedClientToken;
        log('Using trustedClientToken for user info fetch');
      }
    }

    if (!headers['x-lobe-trust-token'] && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      log('Using accessToken for user info fetch');
    }

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

// Authenticated procedure for agent group management
const agentGroupProcedure = authedProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(marketSDK)
  .use(async ({ ctx, next }) => {
    const { UserModel } = await import('@/database/models/user');
    const userModel = new UserModel(ctx.serverDB, ctx.userId);

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
const memberAgentSchema = z.object({
  avatar: z.string().nullish(),
  category: z.string().optional(),
  config: z.record(z.any()),
  description: z.string(),
  displayOrder: z.number().optional(),
  identifier: z.string(),
  name: z.string(),
  role: z.enum(['supervisor', 'participant']),
  url: z.string(),
});

const publishOrCreateGroupSchema = z.object({
  avatar: z.string().nullish(),
  backgroundColor: z.string().nullish(),
  category: z.string().optional(),
  changelog: z.string().optional(),
  config: z
    .object({
      allowDM: z.boolean().optional(),
      openingMessage: z.string().optional(),
      openingQuestions: z.array(z.string()).optional(),
      revealDM: z.boolean().optional(),
      systemPrompt: z.string().optional(),
    })
    .optional(),
  description: z.string(),
  identifier: z.string().nullish(), // Allow null or undefined
  memberAgents: z.array(memberAgentSchema),
  name: z.string(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
});

export const agentGroupRouter = router({
  /**
   * Check if current user owns the specified group
   */
  checkOwnership: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('checkOwnership input: %O', input);

      try {
        const groupDetail = await ctx.marketSDK.agentGroups.getAgentGroupDetail(input.identifier);

        if (!groupDetail) {
          return {
            exists: false,
            isOwner: false,
            originalGroup: null,
          };
        }

        const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
        const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;
        let currentAccountId: number | null = null;

        const marketUserInfoResult = await fetchMarketUserInfo({ accessToken, userInfo });
        currentAccountId = marketUserInfoResult?.accountId ?? null;

        const ownerId = groupDetail.group.ownerId;
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
          originalGroup: isOwner
            ? null
            : {
                // TODO: Add author info from group detail
                author: undefined,
                avatar: groupDetail.group.avatar,
                identifier: groupDetail.group.identifier,
                name: groupDetail.group.name,
              },
        };
      } catch (error) {
        log('Error checking ownership: %O', error);
        return {
          exists: false,
          isOwner: false,
          originalGroup: null,
        };
      }
    }),

  /**
   * Deprecate agent group
   * POST /market/agent-group/:identifier/deprecate
   */
  deprecateAgentGroup: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('deprecateAgentGroup input: %O', input);

      try {
        const deprecateUrl = `${MARKET_BASE_URL}/api/v1/agent-groups/${input.identifier}/deprecate`;

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

        const response = await fetch(deprecateUrl, {
          headers,
          method: 'POST',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log(
            'Deprecate agent group failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to deprecate agent group: ${response.statusText}`);
        }

        log('Deprecate agent group success');
        return { success: true };
      } catch (error) {
        log('Error deprecating agent group: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to deprecate agent group',
        });
      }
    }),

  /**
   * Fork an agent group
   * POST /market/agent-group/:identifier/fork
   */
  forkAgentGroup: agentGroupProcedure
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
      log('forkAgentGroup input: %O', input);

      try {
        // Call Market API directly to fork agent group
        const forkUrl = `${MARKET_BASE_URL}/api/v1/agent-groups/${input.sourceIdentifier}/fork`;

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
          log(
            'Fork agent group failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to fork agent group: ${response.statusText}`);
        }

        const result = await response.json();
        log('Fork agent group success: %O', result);
        return result;
      } catch (error) {
        log('Error forking agent group: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fork agent group',
        });
      }
    }),

  /**
   * Get agent group detail by identifier
   * GET /market/agent-group/:identifier
   */
  getAgentGroupDetail: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getAgentGroupDetail input: %O', input);

      try {
        const response = await ctx.marketSDK.agentGroups.getAgentGroupDetail(input.identifier);
        return response;
      } catch (error) {
        log('Error getting agent group detail: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get agent group detail',
        });
      }
    }),

  /**
   * Get the fork source of an agent group
   * GET /market/agent-group/:identifier/fork-source
   */
  getAgentGroupForkSource: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getAgentGroupForkSource input: %O', input);

      try {
        const forkSourceUrl = `${MARKET_BASE_URL}/api/v1/agent-groups/${input.identifier}/fork-source`;

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
            'Get agent group fork source failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to get agent group fork source: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      } catch (error) {
        log('Error getting agent group fork source: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get agent group fork source',
        });
      }
    }),

  /**
   * Get all forks of an agent group
   * GET /market/agent-group/:identifier/forks
   */
  getAgentGroupForks: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getAgentGroupForks input: %O', input);

      try {
        const forksUrl = `${MARKET_BASE_URL}/api/v1/agent-groups/${input.identifier}/forks`;

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
            'Get agent group forks failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to get agent group forks: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      } catch (error) {
        log('Error getting agent group forks: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get agent group forks',
        });
      }
    }),

  /**
   * Publish agent group
   * POST /market/agent-group/:identifier/publish
   */
  publishAgentGroup: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('publishAgentGroup input: %O', input);

      try {
        const publishUrl = `${MARKET_BASE_URL}/api/v1/agent-groups/${input.identifier}/publish`;

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

        const response = await fetch(publishUrl, {
          headers,
          method: 'POST',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log(
            'Publish agent group failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to publish agent group: ${response.statusText}`);
        }

        log('Publish agent group success');
        return { success: true };
      } catch (error) {
        log('Error publishing agent group: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to publish agent group',
        });
      }
    }),

  /**
   * Unified publish or create agent group flow
   * 1. Check if identifier exists and if current user is owner
   * 2. If not owner or no identifier, create new group
   * 3. Create new version for the group if updating
   */
  publishOrCreate: agentGroupProcedure
    .input(publishOrCreateGroupSchema)
    .mutation(async ({ input, ctx }) => {
      log('publishOrCreate input: %O', input);

      const { identifier: inputIdentifier, name, memberAgents, ...groupData } = input;
      let finalIdentifier = inputIdentifier;
      let isNewGroup = false;

      try {
        // Step 1: Check ownership if identifier is provided
        if (inputIdentifier) {
          try {
            const groupDetail =
              await ctx.marketSDK.agentGroups.getAgentGroupDetail(inputIdentifier);
            log('Group detail for ownership check: ownerId=%s', groupDetail?.group.ownerId);

            const userInfo = ctx.marketUserInfo as TrustedClientUserInfo | undefined;
            const accessToken = (ctx as { marketOidcAccessToken?: string }).marketOidcAccessToken;
            let currentAccountId: number | null = null;

            const marketUserInfoResult = await fetchMarketUserInfo({ accessToken, userInfo });
            currentAccountId = marketUserInfoResult?.accountId ?? null;
            log('Market user info: accountId=%s', currentAccountId);

            const ownerId = groupDetail?.group.ownerId;

            log('Ownership check: currentAccountId=%s, ownerId=%s', currentAccountId, ownerId);

            if (!currentAccountId || `${ownerId}` !== `${currentAccountId}`) {
              // Not the owner, need to create a new group
              log('User is not owner, will create new group');
              finalIdentifier = undefined;
              isNewGroup = true;
            }
          } catch (detailError) {
            // Group not found or error, create new
            log('Group not found or error, will create new: %O', detailError);
            finalIdentifier = undefined;
            isNewGroup = true;
          }
        } else {
          isNewGroup = true;
        }

        // Step 2: Create new group or update existing
        if (!finalIdentifier || isNewGroup) {
          // Generate a unique 8-character identifier
          finalIdentifier = generateMarketIdentifier();
          isNewGroup = true;

          log('Creating new group with identifier: %s', finalIdentifier);

          await ctx.marketSDK.agentGroups.createAgentGroup({
            ...groupData,
            identifier: finalIdentifier,
            // @ts-ignore
            memberAgents,
            name,
          });
        } else {
          // Update existing group - create new version
          log('Creating new version for group: %s', finalIdentifier);

          await ctx.marketSDK.agentGroups.createAgentGroupVersion({
            ...groupData,
            identifier: finalIdentifier,
            // @ts-ignore
            memberAgents,
            name,
          });
        }

        return {
          identifier: finalIdentifier,
          isNewGroup,
          success: true,
        };
      } catch (error) {
        log('Error in publishOrCreate: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to publish group',
        });
      }
    }),

  /**
   * Unpublish agent group
   * POST /market/agent-group/:identifier/unpublish
   */
  unpublishAgentGroup: agentGroupProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('unpublishAgentGroup input: %O', input);

      try {
        const unpublishUrl = `${MARKET_BASE_URL}/api/v1/agent-groups/${input.identifier}/unpublish`;

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

        const response = await fetch(unpublishUrl, {
          headers,
          method: 'POST',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log(
            'Unpublish agent group failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to unpublish agent group: ${response.statusText}`);
        }

        log('Unpublish agent group success');
        return { success: true };
      } catch (error) {
        log('Error unpublishing agent group: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to unpublish agent group',
        });
      }
    }),
});

export type AgentGroupRouter = typeof agentGroupRouter;
