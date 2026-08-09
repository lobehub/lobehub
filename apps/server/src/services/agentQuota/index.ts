import {
  type AccountLoad,
  calibrateCapacity,
  computeTurnCostUsd,
  currentUtilization,
  isScopedWeeklyLimit,
  isSessionLimit,
  isWeeklyAllLimit,
  MIN_CALIBRATION_SAMPLES,
  projectWindows,
  type QuotaAccountIdentity,
  type QuotaLimitReading,
  type QuotaTokenUsage,
  selectAccount,
  windowSecondsForKind,
  windowsToCalibrationIntervals,
} from '@lobechat/heterogeneous-agents/quota';

import type { AccountIdentityInput, SafeAccount } from '@/database/models/agentQuota';
import {
  AgentAccountBindingModel,
  AgentProviderAccountModel,
  AgentQuotaCalibrationModel,
  AgentQuotaSnapshotModel,
  AgentQuotaUsageLedgerModel,
  AgentQuotaWindowModel,
} from '@/database/models/agentQuota';
import type { LobeChatDatabase } from '@/database/type';
import {
  type QuotaAccountCredentialRef,
  QuotaBindingRole,
  QuotaCostSource,
} from '@/database/types/agentQuota';

import { claudeModelPrice } from './pricing';

export interface AccountLoadView extends AccountLoad {
  capacityUsd?: number;
  label?: string | null;
}

/** One assistant turn's spend, as the usage calendar consumes it. */
export interface QuotaUsageTurn {
  /** USD, or null when the model bank has no price for the model. */
  cost: number | null;
  model: string | null;
  occurredAt: number;
  /** All token classes summed — what "tokens burned" means to the user. */
  tokens: number;
}

/**
 * Server-side orchestration for the quota data layer: turns the append-only
 * snapshot + ledger facts into windows and calibrated capacity, and resolves
 * which account an agent should run on. The math all lives in the pure
 * `@lobechat/heterogeneous-agents/quota` module; this class only wires it to
 * the database models.
 */
export class AgentQuotaService {
  private accounts: AgentProviderAccountModel;
  private bindings: AgentAccountBindingModel;
  private snapshots: AgentQuotaSnapshotModel;
  private ledger: AgentQuotaUsageLedgerModel;
  private windows: AgentQuotaWindowModel;
  private calibrations: AgentQuotaCalibrationModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.accounts = new AgentProviderAccountModel(db, userId, workspaceId);
    this.bindings = new AgentAccountBindingModel(db, userId, workspaceId);
    this.snapshots = new AgentQuotaSnapshotModel(db, userId, workspaceId);
    this.ledger = new AgentQuotaUsageLedgerModel(db, userId, workspaceId);
    this.windows = new AgentQuotaWindowModel(db, userId, workspaceId);
    this.calibrations = new AgentQuotaCalibrationModel(db, userId, workspaceId);
  }

  /**
   * Full desktop-sampler entry point: resolve (dedupe) the account by its real
   * identity, then persist the batch of readings. Returns the account so the
   * caller can wire bindings / show it in the switcher.
   */
  ingestSnapshot = async (params: {
    credentialRef?: QuotaAccountCredentialRef;
    deviceId?: string;
    identity: QuotaAccountIdentity;
    provider: string;
    readings: QuotaLimitReading[];
  }): Promise<SafeAccount> => {
    const account = await this.accounts.upsertByIdentity(
      params.provider,
      params.identity as AccountIdentityInput,
      params.credentialRef ? { credentialRef: params.credentialRef } : {},
    );
    await this.ingestReadings(account.id, params.readings, params.deviceId);
    // Ingestion is the only moment new evidence arrives, so it is also the only
    // sensible calibration trigger. Cheap and self-guarding: without enough clean
    // windows `recalibrate` writes nothing rather than guessing.
    await this.recalibrate(account.id);
    return account;
  };

  /**
   * Persist a batch of provider readings and refresh every window they touch.
   * `peakUtilization` merges via GREATEST in the model, so calling this with
   * partial/incremental batches is safe.
   */
  ingestReadings = async (
    accountId: string,
    readings: QuotaLimitReading[],
    deviceId?: string,
  ): Promise<void> => {
    if (readings.length === 0) return;

    await this.snapshots.append(
      readings.map((r) => ({
        accountId,
        capturedAt: new Date(r.capturedAt),
        deviceId,
        isActive: r.isActive,
        limitType: r.limitType,
        resetsAt: r.resetsAt == null ? null : new Date(r.resetsAt),
        scopeKey: r.scopeKey,
        severity: r.severity,
        utilization: r.utilization,
      })),
    );

    for (const w of projectWindows(readings)) {
      const windowStartAt = new Date(w.windowStartAt);
      const resetsAt = new Date(w.resetsAt);
      const observedCostUsd = await this.ledger.sumCostUsd(accountId, windowStartAt, resetsAt);
      await this.windows.upsert({
        accountId,
        contaminated: w.peakUtilization >= 3 && observedCostUsd < 0.5,
        firstSeenAt: new Date(w.firstSeenAt),
        lastSeenAt: new Date(w.lastSeenAt),
        lastUtilization: w.lastUtilization,
        limitType: w.limitType,
        observedCostUsd,
        peakUtilization: w.peakUtilization,
        rateLimitedAt: w.rateLimitedAt == null ? null : new Date(w.rateLimitedAt),
        resetsAt,
        scopeKey: w.scopeKey,
        windowSeconds: w.windowSeconds,
        windowStartAt,
      });
    }
  };

  /**
   * Re-estimate capacity for each (limitType, scopeKey) bucket of an account
   * from its clean windows, writing a new calibration row when there are enough
   * samples. This is the step that turns "% used" into "$ of capacity".
   */
  recalibrate = async (accountId: string): Promise<void> => {
    const windows = await this.windows.listByAccount(accountId, 400);
    // key on the JSON tuple and carry the pair alongside: a scopeKey holding the
    // separator can neither merge two buckets nor be mis-split on the way out
    type Bucket = { limitType: string; rows: typeof windows; scopeKey: string };
    const byBucket = new Map<string, Bucket>();
    for (const w of windows) {
      const key = JSON.stringify([w.limitType, w.scopeKey]);
      const bucket: Bucket = byBucket.get(key) ?? {
        limitType: w.limitType,
        rows: [],
        scopeKey: w.scopeKey,
      };
      bucket.rows.push(w);
      byBucket.set(key, bucket);
    }

    for (const { limitType, rows: list, scopeKey } of byBucket.values()) {
      const intervals = windowsToCalibrationIntervals(
        list.map((w) => ({
          contaminated: w.contaminated,
          observedCostUsd: w.observedCostUsd == null ? null : Number(w.observedCostUsd),
          peakUtilization: w.peakUtilization,
          rateLimitedAt: w.rateLimitedAt ? w.rateLimitedAt.getTime() : null,
        })),
      );
      if (intervals.length < MIN_CALIBRATION_SAMPLES) continue;

      const result = calibrateCapacity(intervals);
      if (!result) continue;

      await this.calibrations.insert({
        accountId,
        capacityUsd: result.capacityUsd,
        confidence: result.confidence,
        limitType,
        method: result.method,
        sampleCount: result.sampleCount,
        scopeKey,
        windowSeconds: windowSecondsForKind(limitType),
      });
    }
  };

  /**
   * Record one assistant turn's consumption in the usage ledger — the "our own
   * spend" half of the Δutilization ↔ Δcost pair that calibration crosses.
   * Cost is computed here from token classes and the model bank's rates (cache
   * read/write price differently — that is why raw token counts are the wrong
   * unit); a model the bank doesn't know stores its tokens with a null cost
   * instead of a guessed one. Idempotent per `externalEventId` (message id), so
   * a replayed event cannot double-count.
   */
  recordUsage = async (params: {
    agentId?: string;
    /** Real provider account id resolved at spawn; attributes the row. */
    externalAccountId?: string;
    messageId?: string;
    model?: string;
    occurredAt?: number;
    operationId?: string;
    provider: string;
    topicId?: string;
    usage: QuotaTokenUsage;
  }): Promise<void> => {
    const externalEventId = params.messageId ?? params.operationId;
    if (!externalEventId) return;

    const account = params.externalAccountId
      ? await this.accounts.findByExternalId(params.provider, params.externalAccountId)
      : null;

    const price = params.model ? claudeModelPrice(params.model) : null;
    const costUsd = price ? computeTurnCostUsd(params.usage, price) : null;

    const row = {
      accountId: account?.id ?? null,
      cacheReadTokens: params.usage.cacheRead ?? null,
      cacheWriteTokens: params.usage.cacheWrite5m ?? params.usage.cacheWrite1h ?? null,
      costSource: costUsd == null ? null : QuotaCostSource.computed,
      costUsd,
      externalEventId,
      inputTokens: params.usage.input ?? null,
      model: params.model ?? null,
      occurredAt: new Date(params.occurredAt ?? Date.now()),
      outputTokens: params.usage.output ?? null,
      provider: params.provider,
      reasoningTokens: params.usage.reasoning ?? null,
    };

    try {
      await this.ledger.append({
        ...row,
        agentId: params.agentId ?? null,
        messageId: params.messageId ?? null,
        operationId: params.operationId ?? null,
        topicId: params.topicId ?? null,
      });
    } catch {
      // The provenance links are FK-checked and the client races the message
      // batcher (or the row may since be deleted). The spend record itself is
      // the valuable part — land it without the links (the message id survives
      // inside externalEventId) rather than silently losing the turn.
      await this.ledger.append(row);
    }
  };

  /**
   * The newest reading per limit bucket, as plain numbers. This is the display
   * read model: unlike `agent_quota_windows` it also carries limits the
   * provider reports without a `resets_at` (an untouched model-scoped weekly),
   * which have no window to be projected into.
   */
  listLatestReadings = async (accountId: string): Promise<QuotaLimitReading[]> => {
    const rows = await this.snapshots.latestPerBucket(accountId);

    return rows.map((row) => ({
      capturedAt: row.capturedAt.getTime(),
      isActive: row.isActive ?? undefined,
      limitType: row.limitType,
      resetsAt: row.resetsAt?.getTime() ?? null,
      scopeKey: row.scopeKey,
      severity: row.severity ?? undefined,
      utilization: row.utilization,
    }));
  };

  /**
   * The full reading series since `since`, oldest first — the burn-down /
   * usage-calendar read model. Same plain-number mapping as
   * `listLatestReadings`.
   */
  listSnapshotSeries = async (accountId: string, since: Date): Promise<QuotaLimitReading[]> => {
    const rows = await this.snapshots.listRange(accountId, since);

    return rows.map((row) => ({
      capturedAt: row.capturedAt.getTime(),
      isActive: row.isActive ?? undefined,
      limitType: row.limitType,
      resetsAt: row.resetsAt?.getTime() ?? null,
      scopeKey: row.scopeKey,
      severity: row.severity ?? undefined,
      utilization: row.utilization,
    }));
  };

  /**
   * Per-turn spend since `since`, oldest first — the token/cost half of the
   * usage calendar. Returned as flat turns rather than pre-bucketed days: the
   * calendar groups by the *viewer's* local day, which the server cannot know.
   */
  listUsageTurns = async (accountId: string, since: Date): Promise<QuotaUsageTurn[]> => {
    const rows = await this.ledger.listSince(accountId, since);

    return rows.map((row) => ({
      cost: row.costUsd == null ? null : Number(row.costUsd),
      model: row.model,
      occurredAt: row.occurredAt.getTime(),
      tokens:
        (row.inputTokens ?? 0) +
        (row.outputTokens ?? 0) +
        (row.cacheReadTokens ?? 0) +
        (row.cacheWriteTokens ?? 0) +
        (row.reasoningTokens ?? 0),
    }));
  };

  /** Build the LB load view for a set of accounts from their latest readings. */
  resolveAccountLoads = async (
    accountIds: string[],
    now: number = Date.now(),
  ): Promise<AccountLoadView[]> => {
    const accounts = await this.accounts.list();
    const byId = new Map(accounts.map((a) => [a.id, a]));

    return Promise.all(
      accountIds.map(async (accountId) => {
        const account = byId.get(accountId);
        const buckets = await this.listLatestReadings(accountId);
        const scopedWeeklyUtil: Record<string, number> = {};
        let sessionUtil = 0;
        let weeklyUtil = 0;
        let rateLimitedUntil: number | null = null;

        for (const b of buckets) {
          // A reading whose window has rolled over describes spend that has
          // since refilled; counting it would keep an account benched long
          // after its quota came back.
          const utilization = currentUtilization(b, now);

          if (isSessionLimit(b)) {
            sessionUtil = utilization;
            // `utilization` is already 0 once the window rolled over, so a
            // stale 100% cannot bench the account past its own reset.
            if (utilization >= 100 && b.resetsAt) rateLimitedUntil = b.resetsAt;
          } else if (isScopedWeeklyLimit(b)) {
            scopedWeeklyUtil[b.scopeKey] = utilization;
          } else if (isWeeklyAllLimit(b)) {
            weeklyUtil = Math.max(weeklyUtil, utilization);
          }
        }

        const calibration = await this.calibrations.latest(accountId, 'weekly_all');

        return {
          accountId,
          capacityUsd: calibration ? Number(calibration.capacityUsd) : undefined,
          enabled: account?.enabled ?? true,
          label: account?.label ?? null,
          priority: 0,
          rateLimitedUntil,
          scopedWeeklyUtil,
          sessionUtil,
          weeklyUtil,
        } satisfies AccountLoadView;
      }),
    );
  };

  /**
   * Pick the account an agent should run on. A pinned binding short-circuits
   * load balancing (that is the UI "switch account" lock); otherwise the pool
   * is ranked weekly-headroom-first, scope-aware.
   *
   * Returns the credential pointer alongside so the spawn side can act on the
   * choice (set `CLAUDE_CONFIG_DIR` for a config-dir profile, leave the default
   * login for keychain) without a second round-trip.
   */
  selectForAgent = async (
    agentId: string,
    options: { modelScope?: string; now?: number } = {},
  ): Promise<{
    accountId: string;
    credentialMode: string;
    credentialRef: QuotaAccountCredentialRef | null;
    externalAccountId: string | null;
    reason: 'pinned' | 'balanced';
  } | null> => {
    const chosen = await this.selectAccountId(agentId, options);
    if (!chosen) return null;

    const account = await this.accounts.findById(chosen.accountId);
    if (!account) return null;

    return {
      accountId: account.id,
      credentialMode: account.credentialMode,
      credentialRef: account.credentialRef ?? null,
      externalAccountId: account.externalAccountId ?? null,
      reason: chosen.reason,
    };
  };

  private selectAccountId = async (
    agentId: string,
    options: { modelScope?: string; now?: number },
  ): Promise<{ accountId: string; reason: 'pinned' | 'balanced' } | null> => {
    const bindings = (await this.bindings.listByAgent(agentId)).filter((b) => b.enabled);
    const pinned = bindings.find((b) => b.role === QuotaBindingRole.pinned);
    if (pinned) return { accountId: pinned.accountId, reason: 'pinned' };

    const pool = bindings.filter((b) => b.role === QuotaBindingRole.pool);
    if (pool.length === 0) return null;

    const now = options.now ?? Date.now();
    const loads = await this.resolveAccountLoads(
      pool.map((b) => b.accountId),
      now,
    );
    const priorityById = new Map(pool.map((b) => [b.accountId, b.priority]));
    const withPriority = loads.map((l) => ({ ...l, priority: priorityById.get(l.accountId) ?? 0 }));

    const chosen = selectAccount(withPriority, { modelScope: options.modelScope, now });
    return chosen ? { accountId: chosen.accountId, reason: 'balanced' } : null;
  };
}
