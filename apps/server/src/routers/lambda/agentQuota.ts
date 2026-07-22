import { z } from 'zod';

import {
  AgentAccountBindingModel,
  AgentProviderAccountModel,
  AgentQuotaWindowModel,
} from '@/database/models/agentQuota';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentQuotaService } from '@/server/services/agentQuota';

const quotaProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      accountModel: new AgentProviderAccountModel(ctx.serverDB, ctx.userId, workspaceId),
      bindingModel: new AgentAccountBindingModel(ctx.serverDB, ctx.userId, workspaceId),
      quotaService: new AgentQuotaService(ctx.serverDB, ctx.userId, workspaceId),
      windowModel: new AgentQuotaWindowModel(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

const providerSchema = z.enum(['claude-code', 'codex']);

const readingSchema = z.object({
  capturedAt: z.number(),
  isActive: z.boolean().optional(),
  limitType: z.string(),
  rateLimited: z.boolean().optional(),
  resetsAt: z.number().nullable(),
  scopeKey: z.string(),
  severity: z.string().optional(),
  utilization: z.number(),
});

export const agentQuotaRouter = router({
  // ── ingestion (desktop sampler → DB) ──────────────────────────────────────
  ingestSnapshot: quotaProcedure
    .input(
      z.object({
        deviceId: z.string().optional(),
        identity: z.object({
          displayName: z.string().optional(),
          email: z.string().optional(),
          externalAccountId: z.string().optional(),
          organizationId: z.string().optional(),
          planTier: z.string().optional(),
          rateLimitTier: z.string().optional(),
        }),
        provider: providerSchema,
        readings: z.array(readingSchema),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.quotaService.ingestSnapshot({
        credentialRef: { origin: 'keychain' },
        deviceId: input.deviceId,
        identity: input.identity,
        provider: input.provider,
        readings: input.readings,
      }),
    ),

  /**
   * One assistant turn's consumption (desktop client-mode runs report from the
   * renderer). Idempotent by message id — replays cannot double-count.
   */
  recordUsage: quotaProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        externalAccountId: z.string().optional(),
        messageId: z.string().optional(),
        model: z.string().optional(),
        occurredAt: z.number().optional(),
        operationId: z.string().optional(),
        provider: providerSchema,
        topicId: z.string().optional(),
        usage: z.object({
          cacheRead: z.number().optional(),
          cacheWrite1h: z.number().optional(),
          cacheWrite5m: z.number().optional(),
          input: z.number().optional(),
          output: z.number().optional(),
          reasoning: z.number().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.quotaService.recordUsage(input)),

  // ── accounts ────────────────────────────────────────────────────────────
  createAccount: quotaProcedure
    .input(
      z.object({
        credentialMode: z.enum(['referenced', 'managed']).default('referenced'),
        label: z.string().optional(),
        provider: providerSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.accountModel.create(input)),

  deleteAccount: quotaProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.accountModel.delete(input.id)),

  listAccounts: quotaProcedure.query(async ({ ctx }) => ctx.accountModel.list()),

  updateAccount: quotaProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          enabled: z.boolean().optional(),
          label: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.accountModel.update(input.id, input.value)),

  // ── bindings (agent ↔ account, incl. UI switch) ──────────────────────────
  bindAccount: quotaProcedure
    .input(
      z.object({
        accountId: z.string(),
        agentId: z.string(),
        priority: z.number().optional(),
        role: z.enum(['pinned', 'pool', 'disabled']).optional(),
        weight: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.bindingModel.upsert(input)),

  listBindings: quotaProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => ctx.bindingModel.listByAgent(input.agentId)),

  /** UI "switch account": pin one account for an agent, demoting any prior pin. */
  switchAccount: quotaProcedure
    .input(z.object({ accountId: z.string(), agentId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.bindingModel.pin(input.agentId, input.accountId)),

  unbindAccount: quotaProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.bindingModel.remove(input.id)),

  // ── quota read (QuotaMenu read model) ────────────────────────────────────
  getWindows: quotaProcedure
    .input(z.object({ accountId: z.string(), limit: z.number().optional() }))
    .query(async ({ ctx, input }) => ctx.windowModel.listByAccount(input.accountId, input.limit)),

  // ── load balancing ───────────────────────────────────────────────────────
  resolveAccountLoads: quotaProcedure
    .input(z.object({ accountIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => ctx.quotaService.resolveAccountLoads(input.accountIds)),

  selectAccountForAgent: quotaProcedure
    .input(z.object({ agentId: z.string(), modelScope: z.string().optional() }))
    .query(async ({ ctx, input }) =>
      ctx.quotaService.selectForAgent(input.agentId, { modelScope: input.modelScope }),
    ),
});

export type AgentQuotaRouter = typeof agentQuotaRouter;
