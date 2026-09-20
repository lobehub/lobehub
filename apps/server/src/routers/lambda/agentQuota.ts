import { z } from 'zod';

import { cloudWorkspaceAuth } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  AgentAccountBindingModel,
  AgentProviderAccountModel,
  AgentQuotaWindowModel,
} from '@/database/models/agentQuota';
import { DeviceModel } from '@/database/models/device';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentQuotaService } from '@/server/services/agentQuota';
import { deviceGateway } from '@/server/services/deviceGateway';

import { assertWorkspaceDeviceVisible } from './deviceWorkspaceGuard';

const quotaProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      deviceModel: new DeviceModel(ctx.serverDB, ctx.userId, workspaceId),
      accountModel: new AgentProviderAccountModel(ctx.serverDB, ctx.userId, workspaceId),
      bindingModel: new AgentAccountBindingModel(ctx.serverDB, ctx.userId, workspaceId),
      quotaService: new AgentQuotaService(ctx.serverDB, ctx.userId, workspaceId),
      windowModel: new AgentQuotaWindowModel(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

const providerSchema = z.enum(['claude-code', 'codex', 'kimi-code']);

const readingSchema = z.object({
  capturedAt: z.number(),
  windowMinutes: z.number().int().positive().optional(),
  limitName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  limitType: z.string(),
  rateLimited: z.boolean().optional(),
  resetsAt: z.number().nullable(),
  scopeKey: z.string(),
  severity: z.string().optional(),
  utilization: z.number(),
});

export const agentQuotaRouter = router({
  /** Refresh on the execution device and publish its sample to the account quota layer. */
  refreshCodexQuota: quotaProcedure
    .use(cloudWorkspaceAuth)
    .input(
      z.object({
        command: z.string().optional(),
        deviceId: z.string(),
        env: z.record(z.string(), z.string()).optional(),
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.workspaceId) await assertWorkspaceDeviceVisible(ctx.deviceModel, input.deviceId);
      const snapshot = await deviceGateway.codexQuota({
        ...input,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (
        snapshot?.status !== 'ok' ||
        !snapshot.identity?.externalAccountId ||
        !snapshot.readings?.length
      )
        return snapshot ?? null;
      const account = await ctx.accountModel.findByExternalId(
        'codex',
        snapshot.identity.externalAccountId,
      );
      const latest = account ? await ctx.quotaService.listLatestReadings(account.id) : [];
      const readings = snapshot.readings.filter(
        (reading) =>
          !latest.some(
            (previous) =>
              previous.limitType === reading.limitType &&
              previous.scopeKey === reading.scopeKey &&
              previous.capturedAt >= reading.capturedAt,
          ),
      );
      if (readings.length) {
        const device =
          (ctx.workspaceId
            ? await ctx.deviceModel.findWorkspaceDeviceById(input.deviceId)
            : undefined) ?? (await ctx.deviceModel.findByDeviceId(input.deviceId));
        await ctx.quotaService.ingestSnapshot({
          deviceId: device?.id,
          identity: snapshot.identity,
          provider: 'codex',
          readings,
        });
      }
      return snapshot;
    }),

  /** Refresh on the execution device and publish its sample to the account quota layer. */
  refreshKimiCodeQuota: quotaProcedure
    .use(cloudWorkspaceAuth)
    .input(
      z.object({
        deviceId: z.string(),
        env: z.record(z.string(), z.string()).optional(),
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.workspaceId) await assertWorkspaceDeviceVisible(ctx.deviceModel, input.deviceId);
      const snapshot = await deviceGateway.kimiCodeQuota({
        ...input,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (
        snapshot?.status !== 'ok' ||
        !snapshot.identity?.externalAccountId ||
        !snapshot.readings?.length
      )
        return snapshot ?? null;
      const account = await ctx.accountModel.findByExternalId(
        'kimi-code',
        snapshot.identity.externalAccountId,
      );
      const latest = account ? await ctx.quotaService.listLatestReadings(account.id) : [];
      const readings = snapshot.readings.filter(
        (reading) =>
          !latest.some(
            (previous) =>
              previous.limitType === reading.limitType &&
              previous.scopeKey === reading.scopeKey &&
              previous.capturedAt >= reading.capturedAt,
          ),
      );
      if (readings.length) {
        const device =
          (ctx.workspaceId
            ? await ctx.deviceModel.findWorkspaceDeviceById(input.deviceId)
            : undefined) ?? (await ctx.deviceModel.findByDeviceId(input.deviceId));
        await ctx.quotaService.ingestSnapshot({
          deviceId: device?.id,
          identity: snapshot.identity,
          provider: 'kimi-code',
          readings,
        });
      }
      return snapshot;
    }),

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
    .mutation(async ({ ctx, input }) => {
      // Clients know a device by its gateway id (the string `devices.device_id`
      // stored in `agencyConfig.boundDeviceId`), but snapshots reference the
      // `devices.id` uuid. Resolve it here rather than trusting the client: a
      // raw gateway id fails the uuid/foreign-key check and would take the
      // whole ingest down with it, silently stranding the reading. An
      // unresolvable device only costs attribution, so keep the reading.
      //
      // A workspace device's identity is `(workspaceId, deviceId)` — `userId`
      // only records the first enroller — so the personal `(userId, deviceId)`
      // lookup misses a machine any other member enrolled. Try the
      // workspace-scoped lookup first when the request carries a workspace
      // (it also applies the device's visibility rules), then fall back to the
      // caller's own devices.
      const deviceModel = new DeviceModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const deviceRow = input.deviceId
        ? ((ctx.workspaceId
            ? await deviceModel.findWorkspaceDeviceById(input.deviceId)
            : undefined) ?? (await deviceModel.findByDeviceId(input.deviceId)))
        : undefined;

      return ctx.quotaService.ingestSnapshot({
        credentialRef: { origin: 'keychain' },
        deviceId: deviceRow?.id,
        identity: input.identity,
        provider: input.provider,
        readings: input.readings,
      });
    }),

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

  /**
   * Display read model: the newest reading per limit bucket. Prefer this over
   * `getWindows` for anything user-facing — windows are keyed by `resets_at`,
   * so limits the provider reports without one never make it into that table.
   */
  getLatestReadings: quotaProcedure
    .input(z.object({ accountId: z.string() }))
    .query(async ({ ctx, input }) => ctx.quotaService.listLatestReadings(input.accountId)),

  /**
   * Full reading time series (oldest first) for the usage calendar's daily
   * burn heat and per-window burn-down curve.
   */
  listSnapshots: quotaProcedure
    .input(z.object({ accountId: z.string(), sinceDays: z.number().min(1).max(90).optional() }))
    .query(async ({ ctx, input }) =>
      ctx.quotaService.listSnapshotSeries(
        input.accountId,
        new Date(Date.now() - (input.sinceDays ?? 42) * 24 * 60 * 60 * 1000),
      ),
    ),

  /**
   * Per-turn token + cost spend (oldest first) for the usage calendar. Kept
   * separate from `listSnapshots`: utilization is the provider's authority on
   * "how much quota is left", the ledger is ours on "what it was spent on".
   */
  listUsageTurns: quotaProcedure
    .input(z.object({ accountId: z.string(), sinceDays: z.number().min(1).max(90).optional() }))
    .query(async ({ ctx, input }) =>
      ctx.quotaService.listUsageTurns(
        input.accountId,
        new Date(Date.now() - (input.sinceDays ?? 42) * 24 * 60 * 60 * 1000),
      ),
    ),

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
