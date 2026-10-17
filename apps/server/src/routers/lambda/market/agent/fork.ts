import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { generateTrustedClientToken } from '@/libs/trusted-client';
import type { AgentForkBatchResult, AgentForkResponse } from '@/types/discover';

import { agentProcedure, agentWriteProcedure, MARKET_BASE_URL } from './procedures';

const log = debug('lambda-router:market:agent');

/**
 * Build market-API auth headers from a procedure context.
 * Mirrors the inline pattern used by other market.* procedures.
 */
const buildMarketAuthHeaders = (ctx: {
  marketOidcAccessToken?: string;
  marketUserInfo?: TrustedClientUserInfo;
}): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (ctx.marketUserInfo) {
    const trustedClientToken = generateTrustedClientToken(ctx.marketUserInfo);
    if (trustedClientToken) {
      headers['x-lobe-trust-token'] = trustedClientToken;
    }
  }

  if (!headers['x-lobe-trust-token'] && ctx.marketOidcAccessToken) {
    headers['Authorization'] = `Bearer ${ctx.marketOidcAccessToken}`;
  }

  return headers;
};

interface ForkAgentItemInput {
  /**
   * When present, fork is attributed to the given Market organization account.
   * Forwarded as `X-Lobe-Owner-Account-Id` so the Market resolves writes to the
   * organization instead of the calling user. The actor must be a member of the
   * target org (enforced server-side by `resolveActingAccount`).
   */
  actAs?: number;
  identifier: string;
  name?: string;
  sourceIdentifier: string;
  status?: 'published' | 'unpublished' | 'archived' | 'deprecated';
  versionNumber?: number;
  visibility?: 'public' | 'private' | 'internal';
}

const forkOneAgent = async (
  item: ForkAgentItemInput,
  baseHeaders: Record<string, string>,
): Promise<AgentForkBatchResult> => {
  try {
    const forkUrl = `${MARKET_BASE_URL}/api/v1/agents/${item.sourceIdentifier}/fork`;
    // Clone so per-item actAs doesn't leak across the batch.
    const headers = { ...baseHeaders };
    if (item.actAs !== undefined) {
      headers['x-lobe-owner-account-id'] = String(item.actAs);
    }
    const response = await fetch(forkUrl, {
      body: JSON.stringify({
        identifier: item.identifier,
        name: item.name,
        status: item.status,
        versionNumber: item.versionNumber,
        visibility: item.visibility,
      }),
      headers,
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(
        'Fork agent failed (source=%s): %s %s - %s',
        item.sourceIdentifier,
        response.status,
        response.statusText,
        errorText,
      );
      return {
        error: {
          code: `HTTP_${response.status}`,
          message: errorText || response.statusText || 'Failed to fork agent',
        },
        sourceIdentifier: item.sourceIdentifier,
        success: false,
      };
    }

    const data = (await response.json()) as AgentForkResponse;
    log('Fork agent success (source=%s)', item.sourceIdentifier);
    return { data, sourceIdentifier: item.sourceIdentifier, success: true };
  } catch (error) {
    log('Error forking agent (source=%s): %O', item.sourceIdentifier, error);
    return {
      error: {
        code: 'FORK_FAILED',
        message: error instanceof Error ? error.message : 'Failed to fork agent',
      },
      sourceIdentifier: item.sourceIdentifier,
      success: false,
    };
  }
};

const forkAgentItemSchema = z.object({
  /**
   * Optional Market organization account id to attribute the fork to. Triggers
   * `X-Lobe-Owner-Account-Id` on the fork request. Caller is responsible for
   * resolving the organization account id before passing this field.
   */
  actAs: z.number().int().positive().optional(),
  identifier: z.string(),
  name: z.string().optional(),
  sourceIdentifier: z.string(),
  status: z.enum(['published', 'unpublished', 'archived', 'deprecated']).optional(),
  versionNumber: z.number().optional(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
});

export const forkProcedures = {
  /**
   * Fork one or more agents in a single batch.
   * POST /market/agent/fork (batch)
   *
   * Best-effort: single-item failures are returned in-line as
   * `{ success: false, error }` and do not abort the rest of the batch.
   */
  forkAgent: agentWriteProcedure
    .input(z.object({ items: z.array(forkAgentItemSchema).min(1) }))
    .mutation(async ({ input, ctx }) => {
      log('forkAgent batch size: %d', input.items.length);

      const headers = buildMarketAuthHeaders(ctx);

      return Promise.all(input.items.map((item) => forkOneAgent(item, headers)));
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
};
