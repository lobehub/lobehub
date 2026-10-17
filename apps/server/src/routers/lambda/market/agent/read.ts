import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { generateTrustedClientToken } from '@/libs/trusted-client';
import { normalizeLocale } from '@/locales/resources';

import { agentProcedure, MARKET_BASE_URL } from './procedures';

const log = debug('lambda-router:market:agent');

const paginationSchema = z.object({
  page: z.number().optional(),
  pageSize: z.number().optional(),
});

export const readProcedures = {
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
   * Get the full curated onboarding agent catalog for the marketplace picker.
   * Proxies to GET /api/v1/agents/onboarding-full with trust-token authentication.
   * Response is keyed by MarketplaceCategory slug.
   */
  getOnboardingFull: agentProcedure
    .input(z.object({ locale: z.string().optional() }).optional().default({}))
    .query(async ({ input, ctx }) => {
      const url = new URL('/api/v1/agents/onboarding-full', MARKET_BASE_URL);
      url.searchParams.set('_ts', String(Date.now()));
      url.searchParams.set('locale', normalizeLocale(input.locale));

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

      try {
        const response = await fetch(url, { headers, method: 'GET' });

        if (!response.ok) {
          const errorText = await response.text();
          log(
            'Get onboarding full failed: %s %s - %s',
            response.status,
            response.statusText,
            errorText,
          );
          throw new Error(`Failed to get onboarding full: ${response.statusText}`);
        }

        return (await response.json()) as Record<string, unknown[]>;
      } catch (error) {
        log('Error getting onboarding full: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get onboarding full',
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
};
