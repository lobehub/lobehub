import { AGENT_MAIL_COMPOSE_MODES, AGENT_MAIL_FOLDERS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService, isAgentAccountError } from '@/server/services/agentIdentity';
import { AgentAccountError } from '@/server/services/agentIdentity/errors';
import { AgentMailboxService } from '@/server/services/agentIdentity/mailbox';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';
import { assertCanEditResource } from '@/server/services/resourcePermission';

/**
 * A person's mailbox over an agent's address — the views, filing and sending
 * the mail page needs.
 *
 * Reading and marking stay at the agent's visibility: the models scope every
 * row by workspace and the agent's visibility, so a foreign id resolves to
 * nothing. Anything that changes what the mailbox holds or speaks also needs
 * `agent:update`, and destroying mail needs *edit* on the agent, because it is
 * shared with everyone who can see that agent.
 */
const mailProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const workspaceId = opts.ctx.workspaceId ?? undefined;
  const accounts = new AgentAccountService(opts.ctx.serverDB, opts.ctx.userId, {
    gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
    registry: createDefaultAgentAccountRegistry(),
    workspaceId,
  });

  return opts.next({
    ctx: {
      mailbox: new AgentMailboxService(opts.ctx.serverDB, opts.ctx.userId, {
        accounts,
        workspaceId,
      }),
    },
  });
});

const mailWriteProcedure = mailProcedure.use(withScopedPermission('agent:update'));

const TRPC_CODE_OF: Partial<Record<AgentAccountError['code'], TRPCError['code']>> = {
  account_not_found: 'NOT_FOUND',
  account_unavailable: 'FORBIDDEN',
  draft_not_found: 'NOT_FOUND',
  draft_sending: 'CONFLICT',
  reply_target_gone: 'NOT_FOUND',
  send_disabled: 'FORBIDDEN',
  send_failed: 'BAD_GATEWAY',
  send_limit_daily: 'TOO_MANY_REQUESTS',
  send_limit_hourly: 'TOO_MANY_REQUESTS',
  send_suspended: 'FORBIDDEN',
};

/** A refusal keeps its message and its `errorData.code`; anything else stays a sanitized 500. */
const mapMailError = (error: unknown, operation: string): never => {
  if (error instanceof TRPCError) throw error;
  if (isAgentAccountError(error)) {
    throw new TRPCError({
      cause: error,
      code: TRPC_CODE_OF[error.code] ?? 'BAD_REQUEST',
      message: error.message,
    });
  }
  console.error(`[agentAccount.mail:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation} mail`,
  });
};

const scopeInput = z.object({
  accountId: z.string().uuid().optional(),
  agentId: z.string().min(1),
});

const cursorSchema = z.object({ id: z.string().uuid(), sortAt: z.coerce.date() });

const limitSchema = z.number().int().min(1).max(100).optional();

const folderSchema = z.enum(AGENT_MAIL_FOLDERS);

/**
 * The mails an action covers. With `conversationIn`, each id stands for its
 * whole conversation inside that view — what acting on a list row means.
 */
const targetInput = z.object({
  conversationIn: folderSchema.optional(),
  ids: z.array(z.string().uuid()).min(1).max(200),
});

const addressSchema = z.object({ address: z.string().email(), name: z.string().optional() });
const addressesSchema = z.array(addressSchema).max(50);

const draftContentSchema = z.object({
  bcc: addressesSchema.optional(),
  cc: addressesSchema.optional(),
  subject: z.string().max(998).nullable().optional(),
  text: z.string().max(1_000_000).optional(),
  to: addressesSchema.optional(),
});

/** Largest trash one call empties; the response says when there is more. */
const EMPTY_TRASH_BATCH = 200;

type MailContext = {
  mailbox: AgentMailboxService;
  serverDB: Parameters<typeof assertAgentUsableBy>[0];
  userId: string;
  workspaceId?: null | string;
};

const resolveIds = async (
  ctx: MailContext,
  input: z.infer<typeof targetInput>,
): Promise<string[]> =>
  input.conversationIn
    ? ctx.mailbox.mail.expandToConversations(input.ids, input.conversationIn)
    : input.ids;

const assertCanSee = (ctx: MailContext, agentId: string) =>
  assertAgentUsableBy(ctx.serverDB, agentId, {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? undefined,
  });

const assertCanEditAll = async (ctx: MailContext, agentIds: string[]) => {
  for (const agentId of new Set(agentIds)) {
    await assertCanEditResource({
      db: ctx.serverDB,
      resourceId: agentId,
      resourceType: 'agent',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? undefined,
    });
  }
};

const DRAFT_SENDING_MESSAGE = 'This draft is being sent and can no longer be edited.';

const assertDraftAccountUsable = async (ctx: MailContext, accountId: string) => {
  const account = await ctx.mailbox.requireAccount(accountId);
  await assertCanSee(ctx, account.agentId);
  await ctx.mailbox.assertCanUseAll([account.agentId]);
  return account;
};

export const agentAccountMailRouter = router({
  /** Inbox, Sent, Starred or Trash as conversations, newest first. */
  list: mailProcedure
    .input(
      scopeInput.extend({
        before: cursorSchema.optional(),
        folder: folderSchema,
        limit: limitSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCanSee(ctx, input.agentId);
      return ctx.mailbox.mail.listConversations(input);
    }),

  /** Subject, sender, recipients and body, across everything not trashed. */
  search: mailProcedure
    .input(
      scopeInput.extend({
        before: cursorSchema.optional(),
        limit: limitSchema,
        query: z.string().trim().min(1).max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCanSee(ctx, input.agentId);
      return ctx.mailbox.mail.listConversations(input);
    }),

  counts: mailProcedure.input(scopeInput).query(async ({ ctx, input }) => {
    await assertCanSee(ctx, input.agentId);
    const [unread, drafts] = await Promise.all([
      ctx.mailbox.mail.countUnread(input),
      ctx.mailbox.drafts.count(input),
    ]);
    return { drafts, unread };
  }),

  /** A mail's conversation, oldest first. Empty when the mail is not reachable. */
  conversation: mailProcedure
    .input(z.object({ folder: folderSchema.optional(), id: z.string().uuid() }))
    .query(async ({ ctx, input }) => ctx.mailbox.mail.listConversation(input)),

  markRead: mailProcedure.input(targetInput).mutation(async ({ ctx, input }) => ({
    count: await ctx.mailbox.mail.markRead(await resolveIds(ctx, input)),
  })),

  markUnread: mailProcedure.input(targetInput).mutation(async ({ ctx, input }) => ({
    count: await ctx.mailbox.mail.markUnread(await resolveIds(ctx, input)),
  })),

  setStarred: mailProcedure
    .input(targetInput.extend({ starred: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      count: await ctx.mailbox.mail.setStarred(await resolveIds(ctx, input), input.starred),
    })),

  /** Returns the ids it moved, so the caller's undo restores exactly those. */
  trash: mailWriteProcedure.input(targetInput).mutation(async ({ ctx, input }) => {
    const ids = await resolveIds(ctx, input);
    await ctx.mailbox.assertCanUseAll(await ctx.mailbox.mail.listAgentIds(ids));
    const moved = await ctx.mailbox.mail.moveToTrash(ids);
    return { count: moved.length, ids: moved };
  }),

  restore: mailWriteProcedure.input(targetInput).mutation(async ({ ctx, input }) => {
    const ids = await resolveIds(ctx, input);
    await ctx.mailbox.assertCanUseAll(await ctx.mailbox.mail.listAgentIds(ids));
    return { count: await ctx.mailbox.mail.restore(ids) };
  }),

  /**
   * Permanently delete trashed mail, on the provider too. Only trashed mail is
   * eligible, so one call cannot destroy live mail. `failed` counts mails whose
   * provider copy could not be deleted; they stay in the trash.
   */
  purge: mailWriteProcedure.input(targetInput).mutation(async ({ ctx, input }) => {
    const targets = await ctx.mailbox.mail.listPurgeTargets(await resolveIds(ctx, input));
    await assertCanEditAll(
      ctx,
      targets.map((target) => target.agentId),
    );
    return ctx.mailbox.purge(targets);
  }),

  /** One batch of an address's trash; call again while `hasMore`. */
  emptyTrash: mailWriteProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const account = await ctx.mailbox
        .requireAccount(input.accountId)
        .catch((error: unknown) => mapMailError(error, 'empty the trash of'));
      await assertCanSee(ctx, account.agentId);
      await assertCanEditAll(ctx, [account.agentId]);

      const targets = await ctx.mailbox.mail.listTrashTargets({
        accountId: input.accountId,
        limit: EMPTY_TRASH_BATCH,
      });
      const result = await ctx.mailbox.purge(targets);

      return {
        ...result,
        // Stop once a batch made no progress, or the caller loops on failures.
        hasMore: targets.length === EMPTY_TRASH_BATCH && result.count > 0,
      };
    }),

  /** Write, reply, reply-all or forward as a person. */
  send: mailWriteProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        bcc: addressesSchema.optional(),
        cc: addressesSchema.optional(),
        forwardAttachmentIndexes: z.array(z.number().int().min(0)).optional(),
        mode: z.enum(AGENT_MAIL_COMPOSE_MODES),
        sourceMailId: z.string().uuid().optional(),
        subject: z.string().max(998).nullable().optional(),
        text: z.string().min(1).max(1_000_000),
        to: addressesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.mailbox.send(input).catch((error: unknown) => mapMailError(error, 'send')),
    ),

  drafts: router({
    list: mailProcedure
      .input(
        scopeInput.extend({
          before: z.object({ id: z.string().uuid(), updatedAt: z.coerce.date() }).optional(),
          limit: limitSchema,
        }),
      )
      .query(async ({ ctx, input }) => {
        await assertCanSee(ctx, input.agentId);
        return ctx.mailbox.drafts.list(input);
      }),

    get: mailProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      const draft = await ctx.mailbox.drafts.findById(input.id);
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      return draft;
    }),

    create: mailWriteProcedure
      .input(
        draftContentSchema.extend({
          accountId: z.string().uuid(),
          mode: z.enum(AGENT_MAIL_COMPOSE_MODES).default('compose'),
          sourceMailId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const account = await assertDraftAccountUsable(ctx, input.accountId).catch(
          (error: unknown) => mapMailError(error, 'save'),
        );
        const draft = await ctx.mailbox.drafts.create({ ...input, agentId: account.agentId });
        if (!draft) {
          mapMailError(new AgentAccountError('draft_sending', DRAFT_SENDING_MESSAGE), 'save');
        }
        return draft!;
      }),

    update: mailWriteProcedure
      .input(draftContentSchema.extend({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...content } = input;
        await ctx.mailbox.assertCanUseAll(await ctx.mailbox.drafts.listAgentIds([id]));
        const draft = await ctx.mailbox.drafts.update(id, content);
        if (draft) return draft;
        // Refused because a send holds it, not because it is gone: say so, so
        // the client keeps the edit instead of treating the draft as deleted.
        if (await ctx.mailbox.drafts.findById(id)) {
          mapMailError(new AgentAccountError('draft_sending', DRAFT_SENDING_MESSAGE), 'save');
        }
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      }),

    delete: mailWriteProcedure
      .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.mailbox.assertCanUseAll(await ctx.mailbox.drafts.listAgentIds(input.ids));
        return { count: await ctx.mailbox.drafts.delete(input.ids) };
      }),

    send: mailWriteProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) =>
        ctx.mailbox.sendDraft(input.id).catch((error: unknown) => mapMailError(error, 'send')),
      ),
  }),
});
