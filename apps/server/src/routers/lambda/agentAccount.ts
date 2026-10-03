import { AGENT_ACCOUNT_KINDS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService, isAgentAccountError } from '@/server/services/agentIdentity';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';

/**
 * Agent accounts — the identity assets an agent owns (mail / phone / wallet /
 * service) and the credentials some of them carry.
 *
 * The router is a thin control plane over `AgentAccountService`: the service
 * owns provider orchestration and the model owns storage + scoping. Two rules
 * are enforced here rather than there:
 *
 * 1. Every write states which agent it acts on and proves the caller may use
 *    that agent (`assertAgentUsableBy`), so an account can never be attached to
 *    someone else's private agent.
 * 2. Installing a credential is separated from managing the account. It is the
 *    only write that stores a secret, it is write-only (nothing returns it),
 *    and a restricted API key needs `agent:credential:write` on top of
 *    `agent:write` (see `TRPC_PROCEDURE_EXTRA_SCOPES`).
 */
const agentAccountProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return opts.next({
    ctx: {
      agentAccountService: new AgentAccountService(opts.ctx.serverDB, opts.ctx.userId, {
        gateKeeper,
        registry: createDefaultAgentAccountRegistry(),
        workspaceId: opts.ctx.workspaceId ?? undefined,
      }),
    },
  });
});

const agentAccountWriteProcedure = agentAccountProcedure.use(withScopedPermission('agent:update'));

const idInput = z.object({ id: z.string().min(1) });

const capabilitiesSchema = z.object({
  login: z.boolean().optional(),
  receive: z.boolean(),
  send: z.boolean(),
  sign: z.boolean().optional(),
});

/** Non-secret display facts. `rotatedAt` is stamped by the model, not the caller. */
const credentialHintSchema = z.object({
  expiresAt: z.string().optional(),
  masked: z.string().optional(),
  username: z.string().optional(),
});

const credentialSchema = z
  .record(z.string(), z.string())
  .refine((value) => Object.keys(value).length > 0, 'credential must not be empty');

const ACCOUNT_NOT_FOUND_MESSAGE = 'Agent account not found';

/** Surface a service-layer refusal as a tRPC error the caller can act on. */
const mapAccountError = (error: unknown, operation: string): never => {
  if (error instanceof TRPCError) throw error;
  // A handle already bound elsewhere, or a provider pool with nothing left:
  // the request was valid, the deployment's state refuses it.
  if (isAgentAccountError(error)) {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: error.message });
  }
  console.error(`[agentAccount:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : `Failed to ${operation} agent account`,
  });
};

export const agentAccountRouter = router({
  /**
   * The accounts in the caller's scope. Credentials are structurally absent —
   * a list answers "which identities exist and do they have a secret", never
   * "what is the secret".
   */
  list: agentAccountProcedure
    .input(
      z
        .object({
          agentId: z.string().min(1).optional(),
          kind: z.enum(AGENT_ACCOUNT_KINDS).optional(),
          provider: z.string().min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => ctx.agentAccountService.list(input)),

  get: agentAccountProcedure.input(idInput).query(async ({ ctx, input }) => {
    const account = await ctx.agentAccountService.get(input.id);
    if (!account) {
      throw new TRPCError({ code: 'NOT_FOUND', message: ACCOUNT_NOT_FOUND_MESSAGE });
    }
    return account;
  }),

  /**
   * Mount an account the caller already holds a handle for (a `user`-provided
   * login, or one issued out of band). Deliberately takes no credential: the
   * only way a secret enters an account is {@link setCredential}.
   */
  create: agentAccountWriteProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        capabilities: capabilitiesSchema.optional(),
        displayName: z.string().min(1).optional(),
        identifier: z.string().min(1),
        kind: z.enum(AGENT_ACCOUNT_KINDS),
        metadata: z.record(z.string(), z.unknown()).optional(),
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgentUsableBy(ctx.serverDB, input.agentId, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      try {
        return await ctx.agentAccountService.create(input);
      } catch (error) {
        mapAccountError(error, 'create');
      }
    }),

  /**
   * Ask a provider to issue a brand-new account (a lobe.id inbox, a Linq
   * number) and persist it. A provider-issued secret — an inbox signing key —
   * is stored encrypted and never returned, exactly like a caller-supplied one.
   */
  provision: agentAccountWriteProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        displayName: z.string().min(1).optional(),
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgentUsableBy(ctx.serverDB, input.agentId, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      try {
        return await ctx.agentAccountService.provision(input);
      } catch (error) {
        mapAccountError(error, 'provision');
      }
    }),

  /**
   * Patch the non-secret fields. `status` is NOT patchable here: moving an
   * account out of service has to release it on the provider first, which is
   * what {@link revoke} does.
   */
  update: agentAccountWriteProcedure
    .input(
      idInput.extend({
        capabilities: capabilitiesSchema.optional(),
        displayName: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const updated = await ctx.agentAccountService.update(id, patch);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: ACCOUNT_NOT_FOUND_MESSAGE });
      }
      return { id: updated, success: true as const };
    }),

  /**
   * Install or rotate the account's credential. Write-only: the response
   * reports that a secret now exists, never what it is. A restricted API key
   * must additionally hold `agent:credential:write`.
   */
  setCredential: agentAccountWriteProcedure
    .input(
      idInput.extend({
        credential: credentialSchema,
        hint: credentialHintSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, credential, hint } = input;
      const updated = await ctx.agentAccountService.setCredential(id, credential, hint);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: ACCOUNT_NOT_FOUND_MESSAGE });
      }
      return { hasCredential: true, id: updated, success: true as const };
    }),

  /**
   * Release the account (provider side first, when the provider is still
   * configured) and purge its credential.
   */
  revoke: agentAccountWriteProcedure
    .input(
      idInput.extend({
        purgeCredential: z.boolean().optional(),
        release: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...options } = input;
      const revoked = await ctx.agentAccountService.revoke(id, options);
      if (!revoked) {
        throw new TRPCError({ code: 'NOT_FOUND', message: ACCOUNT_NOT_FOUND_MESSAGE });
      }
      return { id: revoked, success: true as const };
    }),
});
