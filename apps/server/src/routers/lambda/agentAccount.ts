import { AGENT_ACCOUNT_KINDS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import type { LobeChatDatabase } from '@/database/type';
import { AgentInboxModel } from '@/database/models/agentInbox';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService, isAgentAccountError } from '@/server/services/agentIdentity';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';
import { assertCanEditResource } from '@/server/services/resourcePermission';

/**
 * Agent accounts — the identity assets an agent owns (mail / wallet / service)
 * and the credentials some of them carry.
 *
 * The router is a thin control plane over `AgentAccountService`: the service
 * owns provider orchestration and the model owns storage + scoping. Two rules
 * are enforced here rather than there:
 *
 * 1. Every write states which agent it acts on and proves the caller may
 *    **edit** that agent: `assertAgentUsableBy` (the visibility predicate) for
 *    the 404 a foreign private agent deserves, plus the resource ACL for the
 *    403 a `view` / `use` shared agent deserves. Looking at an agent is not
 *    permission to take over its identity.
 * 2. Installing a credential is separated from managing the account. It is the
 *    only write that stores a secret, it is write-only (nothing returns it),
 *    and a restricted API key needs `agent:credential:write` on top of
 *    `agent:write` (see `TRPC_PROCEDURE_EXTRA_SCOPES`).
 */
const agentAccountProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const workspaceId = opts.ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentAccountService: new AgentAccountService(opts.ctx.serverDB, opts.ctx.userId, {
        gateKeeper,
        registry: createDefaultAgentAccountRegistry(),
        workspaceId,
      }),
      // The inbox is scoped exactly like the accounts: by the caller's
      // ownership, so an id from someone else's inbox resolves to nothing.
      agentInboxModel: new AgentInboxModel(opts.ctx.serverDB, opts.ctx.userId, workspaceId),
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
const MESSAGE_NOT_FOUND_MESSAGE = 'Agent inbox message not found';

/**
 * A preferred handle for a new account — the local part of a mail address.
 *
 * Kept to the character set every provider accepts, so a rejection is the
 * provider's ("already taken") rather than a validation surprise.
 */
const prefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/, 'prefix may only contain letters, numbers, dot, underscore and dash');

/** Surface a service-layer refusal as a tRPC error the caller can act on. */
const mapAccountError = (error: unknown, operation: string): never => {
  if (error instanceof TRPCError) throw error;
  // A handle already bound elsewhere: the request was valid, the
  // deployment's state refuses it.
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

type AgentAccountWriteScope = {
  agentAccountService: AgentAccountService;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: null | string;
};

/**
 * Account writes are agent writes, and only the agent's *edit* level authorizes
 * them: an account carries an address and, through `setCredential`, a secret.
 *
 * `assertAgentUsableBy` is not enough on its own — it resolves visibility, so a
 * member who may merely view or use a public agent another member created would
 * otherwise be able to rotate that agent's credential or release its identity.
 * The resource ACL answers the actual question, and returns early outside a
 * workspace, where the model's `userId` scope already keeps rows personal.
 */
const assertCanEditAgent = async (
  scope: AgentAccountWriteScope,
  agentId: string,
): Promise<void> => {
  await assertCanEditResource({
    db: scope.serverDB,
    resourceId: agentId,
    resourceType: 'agent',
    userId: scope.userId,
    workspaceId: scope.workspaceId ?? undefined,
  });
};

/**
 * The same check for a mutation addressed by account id: resolve the account
 * first (through the service's scoped `get`, so an account outside the caller's
 * scope stays a plain 404 and the ACL never becomes an oracle for what exists),
 * then authorize the write against the agent that owns it.
 */
const assertAccountEditable = async (
  scope: AgentAccountWriteScope,
  id: string,
): Promise<string> => {
  const account = await scope.agentAccountService.get(id);
  if (!account) {
    throw new TRPCError({ code: 'NOT_FOUND', message: ACCOUNT_NOT_FOUND_MESSAGE });
  }

  await assertCanEditAgent(scope, account.agentId);

  return account.agentId;
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
      await assertCanEditAgent(ctx, input.agentId);

      try {
        return await ctx.agentAccountService.create(input);
      } catch (error) {
        mapAccountError(error, 'create');
      }
    }),

  /**
   * Ask a provider to issue a brand-new account (a lobe.id inbox) and persist
   * it. A provider-issued secret — an inbox signing key — is stored encrypted
   * and never returned, exactly like a caller-supplied one.
   *
   * `prefix` is a *preference*, not a contract: a mail inbox is opened at
   * `<prefix>@…` when the provider can honour it. The response always carries
   * the identifier that was actually issued, so the caller shows the real
   * address rather than the one it asked for.
   */
  provision: agentAccountWriteProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        displayName: z.string().min(1).optional(),
        prefix: prefixSchema.optional(),
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgentUsableBy(ctx.serverDB, input.agentId, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      await assertCanEditAgent(ctx, input.agentId);

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
      await assertAccountEditable(ctx, id);

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
      await assertAccountEditable(ctx, id);

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
      await assertAccountEditable(ctx, id);

      const revoked = await ctx.agentAccountService.revoke(id, options);
      if (!revoked) {
        throw new TRPCError({ code: 'NOT_FOUND', message: ACCOUNT_NOT_FOUND_MESSAGE });
      }
      return { id: revoked, success: true as const };
    }),

  /**
   * The agent's inbox: what its accounts have received.
   *
   * Reads return the caller's own rows only — the model scopes by ownership, so
   * an id from someone else's inbox resolves to nothing. Ingest lives on the
   * webhook path, not here: nothing in this router can fabricate a delivery.
   * Opening a message is the one state change, and it is deliberately
   * auth-and-scope only rather than an `agent:update` edit — reading your own
   * mail is not a change to the agent's configuration.
   */
  inbox: router({
    list: agentAccountProcedure
      .input(
        z.object({
          accountId: z.string().min(1).optional(),
          agentId: z.string().min(1),
          /** Keyset cursor: the last row of the previous page. */
          before: z.object({ id: z.string().min(1), receivedAt: z.coerce.date() }).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          unreadOnly: z.boolean().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await assertAgentUsableBy(ctx.serverDB, input.agentId, {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });

        return ctx.agentInboxModel.list(input);
      }),

    unreadCount: agentAccountProcedure
      .input(z.object({ agentId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await assertAgentUsableBy(ctx.serverDB, input.agentId, {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });

        return { unreadCount: await ctx.agentInboxModel.unreadCount(input.agentId) };
      }),

    get: agentAccountProcedure.input(idInput).query(async ({ ctx, input }) => {
      const message = await ctx.agentInboxModel.findById(input.id);
      if (!message) {
        throw new TRPCError({ code: 'NOT_FOUND', message: MESSAGE_NOT_FOUND_MESSAGE });
      }
      return message;
    }),

    markRead: agentAccountProcedure
      .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }))
      .mutation(async ({ ctx, input }) => ({
        count: await ctx.agentInboxModel.markRead(input.ids),
      })),

    markAllRead: agentAccountProcedure
      .input(z.object({ agentId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await assertAgentUsableBy(ctx.serverDB, input.agentId, {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });

        return { count: await ctx.agentInboxModel.markAllRead(input.agentId) };
      }),
  }),
});
