import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';

const log = debug('lambda-router:market:socialProfile');

const MARKET_BASE_URL = process.env.MARKET_BASE_URL || 'https://market.lobehub.com';

// Authenticated procedure for social profile operations
const socialProfileAuthProcedure = authedProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(marketSDK);

export interface ClaimableResource {
  description?: string;
  id: number;
  identifier: string;
  name?: string;
  parsedUrl?: {
    fullName: string;
    owner: string;
    repo: string;
  };
  type: 'plugin' | 'skill';
  url?: string;
}

export interface ClaimableResources {
  plugins: ClaimableResource[];
  skills: ClaimableResource[];
}

export const socialProfileRouter = router({
  /**
   * Claim resources (Plugins and/or Skills)
   * API expects one asset at a time: { assetId: number, assetType: 'skill' | 'plugin' }
   */
  claimResources: socialProfileAuthProcedure
    .input(
      z.object({
        pluginIds: z.array(z.string()).optional(),
        skillIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('claimResources input: %O', input);

      try {
        // @ts-ignore - headers is protected but we need it for custom API calls
        const headers = ctx.marketSDK.headers as Record<string, string>;

        const claimed: Array<{ assetId: number; assetType: string }> = [];
        const errors: string[] = [];

        // Claim each skill one by one
        for (const skillId of input.skillIds || []) {
          try {
            const response = await fetch(`${MARKET_BASE_URL}/api/v1/user/claims`, {
              body: JSON.stringify({
                assetId: Number(skillId),
                assetType: 'skill',
              }),
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              method: 'POST',
            });

            if (response.ok) {
              claimed.push({ assetId: Number(skillId), assetType: 'skill' });
            } else {
              const error = await response.json().catch(() => ({}));
              errors.push(error.error || `Failed to claim skill ${skillId}`);
            }
          } catch (err) {
            errors.push(`Failed to claim skill ${skillId}`);
          }
        }

        // Claim each plugin one by one
        for (const pluginId of input.pluginIds || []) {
          try {
            const response = await fetch(`${MARKET_BASE_URL}/api/v1/user/claims`, {
              body: JSON.stringify({
                assetId: Number(pluginId),
                assetType: 'plugin',
              }),
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              method: 'POST',
            });

            if (response.ok) {
              claimed.push({ assetId: Number(pluginId), assetType: 'plugin' });
            } else {
              const error = await response.json().catch(() => ({}));
              errors.push(error.error || `Failed to claim plugin ${pluginId}`);
            }
          } catch (err) {
            errors.push(`Failed to claim plugin ${pluginId}`);
          }
        }

        // If nothing was claimed and there were errors, throw
        if (claimed.length === 0 && errors.length > 0) {
          throw new Error(errors[0]);
        }

        return {
          claimed,
          errors: errors.length > 0 ? errors : undefined,
          success: claimed.length > 0,
        };
      } catch (error) {
        log('Error claiming resources: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to claim resources',
        });
      }
    }),

  /**
   * Scan for claimable resources (MCPs and Skills)
   */
  scanClaimableResources: socialProfileAuthProcedure.query(async ({ ctx }) => {
    log('scanClaimableResources');

    try {
      // @ts-ignore - headers is protected but we need it for custom API calls
      const headers = ctx.marketSDK.headers as Record<string, string>;

      const response = await fetch(`${MARKET_BASE_URL}/api/v1/user/claims/scan`, {
        headers,
        method: 'GET',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || `Failed to scan claimable resources: ${response.status}`;
        throw new TRPCError({
          code: response.status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: errorMessage,
        });
      }

      const responseData = await response.json();
      // API returns { data: { plugins: [], skills: [] } }
      const data = responseData.data || responseData;
      return {
        plugins: (data.plugins || []) as ClaimableResource[],
        skills: (data.skills || []) as ClaimableResource[],
      };
    } catch (error) {
      log('Error scanning claimable resources: %O', error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to scan claimable resources',
      });
    }
  }),

  /**
   * Submit a GitHub repository URL for import
   */
  submitRepo: socialProfileAuthProcedure
    .input(
      z.object({
        branch: z.string().optional(),
        gitUrl: z.string().url(),
        type: z.enum(['skill', 'plugin']).default('skill'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('submitRepo input: %O', input);

      try {
        // @ts-ignore - headers is protected but we need it for custom API calls
        const headers = ctx.marketSDK.headers as Record<string, string>;

        const response = await fetch(`${MARKET_BASE_URL}/api/v1/user/claims/submit-repo`, {
          body: JSON.stringify({
            branch: input.branch,
            gitUrl: input.gitUrl,
            type: input.type,
          }),
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || `Failed to submit repository: ${response.status}`;
          // Use BAD_REQUEST for 400 errors (user input errors)
          throw new TRPCError({
            code: response.status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
            message: errorMessage,
          });
        }

        const data = await response.json();
        return {
          message: data.message,
          success: true,
        };
      } catch (error) {
        log('Error submitting repository: %O', error);
        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to submit repository',
        });
      }
    }),
});

export type SocialProfileRouter = typeof socialProfileRouter;
