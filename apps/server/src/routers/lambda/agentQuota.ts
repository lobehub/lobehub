import { TRPCError } from '@trpc/server';
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
import { AccountNotSignedInOnDeviceError, AgentQuotaService } from '@/server/services/agentQuota';
import { resolveDeviceRowId } from '@/server/services/agentQuota/resolveDeviceRowId';
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
/** `devices.id` of a device the client names by its gateway id; see `resolveDeviceRowId`. */
const deviceRowIdOf = (
  ctx: { deviceModel: DeviceModel; workspaceId?: string | null },
  gatewayDeviceId: string | undefined,
) => resolveDeviceRowId(ctx.deviceModel, ctx.workspaceId, gatewayDeviceId);

/** Like `deviceRowIdOf`, for writes that cannot proceed without the device. */
const requireDeviceRowId = async (
  ctx: { deviceModel: DeviceModel; workspaceId?: string | null },
  gatewayDeviceId: string,
): Promise<string> => {
  const id = await deviceRowIdOf(ctx, gatewayDeviceId);
  if (!id) throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found' });
  return id;
};

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
        extraUsage: z
          .object({
            balanceCents: z.number(),
            currency: z.string(),
            monthlyChargeLimitCents: z.number(),
            monthlyChargeLimitEnabled: z.boolean(),
            monthlyUsedCents: z.number(),
            totalCents: z.number(),
          })
          .nullish(),
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
      // An unresolvable device only costs attribution, so keep the reading: a
      // raw gateway id would fail the uuid/foreign-key check and take the whole
      // ingest down with it, silently stranding the reading.
      const deviceRowId = await deviceRowIdOf(ctx, input.deviceId);

      return ctx.quotaService.ingestSnapshot({
        credentialRef: { origin: 'keychain' },
        deviceId: deviceRowId,
        extraUsage: input.extraUsage,
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

  // ── per-device account choice (a login only exists on its machine) ───────
  /** The account an agent uses on one device; `accountId: null` = Auto there. */
  getDeviceAccount: quotaProcedure
    .input(z.object({ agentId: z.string(), deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deviceRowId = await deviceRowIdOf(ctx, input.deviceId);
      return {
        accountId: deviceRowId
          ? await ctx.quotaService.getDeviceAccount(input.agentId, deviceRowId)
          : null,
      };
    }),

  /** Pin an account for an agent on one device, or return it to Auto (`accountId: null`). */
  setDeviceAccount: quotaProcedure
    .input(
      z.object({ accountId: z.string().nullable(), agentId: z.string(), deviceId: z.string() }),
    )
    .mutation(async ({ ctx, input }) => {
      const deviceRowId = await requireDeviceRowId(ctx, input.deviceId);
      try {
        await ctx.quotaService.setDeviceAccount(input.agentId, deviceRowId, input.accountId);
      } catch (error) {
        if (error instanceof AccountNotSignedInOnDeviceError)
          throw new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message: error.message,
          });
        throw error;
      }
    }),

  /** A device reports every login it holds for a provider; the rest are forgotten there. */
  syncDeviceLogins: quotaProcedure
    .input(
      z.object({
        deviceId: z.string(),
        externalAccountIds: z.array(z.string()),
        provider: providerSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deviceRowId = await requireDeviceRowId(ctx, input.deviceId);
      await ctx.quotaService.syncDeviceLogins(
        deviceRowId,
        input.provider,
        input.externalAccountIds,
      );
    }),

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

  /** Agent runs in flight on an account — who is spending it right now. */
  listActiveRuns: quotaProcedure
    .input(z.object({ accountId: z.string() }))
    .query(async ({ ctx, input }) => ctx.quotaService.listActiveRuns(input.accountId)),

  // ── load balancing ───────────────────────────────────────────────────────
  resolveAccountLoads: quotaProcedure
    .input(z.object({ accountIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => ctx.quotaService.resolveAccountLoads(input.accountIds)),

  selectAccountForAgent: quotaProcedure
    .input(
      z.object({
        agentId: z.string(),
        /** Gateway id of the device the run spawns on. */
        deviceId: z.string().optional(),
        modelScope: z.string().optional(),
        provider: z.string().optional(),
        runnableExternalAccountIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.quotaService.selectForAgent(input.agentId, {
        deviceId: await deviceRowIdOf(ctx, input.deviceId),
        modelScope: input.modelScope,
        provider: input.provider,
        runnableExternalAccountIds: input.runnableExternalAccountIds,
      }),
    ),
});

export type AgentQuotaRouter = typeof agentQuotaRouter;
