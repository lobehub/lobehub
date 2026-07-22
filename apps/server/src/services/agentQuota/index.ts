import {
  type AccountLoad,
  calibrateCapacity,
  MIN_CALIBRATION_SAMPLES,
  projectWindows,
  type QuotaAccountIdentity,
  type QuotaLimitReading,
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
import { type QuotaAccountCredentialRef, QuotaBindingRole } from '@/database/types/agentQuota';

export interface AccountLoadView extends AccountLoad {
  capacityUsd?: number;
  label?: string | null;
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

  /** Build the LB load view for a set of accounts from their latest readings. */
  resolveAccountLoads = async (accountIds: string[]): Promise<AccountLoadView[]> => {
    const accounts = await this.accounts.list();
    const byId = new Map(accounts.map((a) => [a.id, a]));

    return Promise.all(
      accountIds.map(async (accountId) => {
        const account = byId.get(accountId);
        const buckets = await this.snapshots.latestPerBucket(accountId);
        const scopedWeeklyUtil: Record<string, number> = {};
        let sessionUtil = 0;
        let weeklyUtil = 0;
        let rateLimitedUntil: number | null = null;

        for (const b of buckets) {
          if (b.limitType === 'session') {
            sessionUtil = b.utilization;
            if (b.utilization >= 100 && b.resetsAt) rateLimitedUntil = b.resetsAt.getTime();
          } else if (b.limitType === 'weekly_scoped' && b.scopeKey) {
            scopedWeeklyUtil[b.scopeKey] = b.utilization;
          } else if (b.limitType.startsWith('weekly')) {
            weeklyUtil = Math.max(weeklyUtil, b.utilization);
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
   */
  selectForAgent = async (
    agentId: string,
    options: { modelScope?: string; now?: number } = {},
  ): Promise<{ accountId: string; reason: 'pinned' | 'balanced' } | null> => {
    const bindings = (await this.bindings.listByAgent(agentId)).filter((b) => b.enabled);
    const pinned = bindings.find((b) => b.role === QuotaBindingRole.pinned);
    if (pinned) return { accountId: pinned.accountId, reason: 'pinned' };

    const pool = bindings.filter((b) => b.role === QuotaBindingRole.pool);
    if (pool.length === 0) return null;

    const now = options.now ?? Date.now();
    const loads = await this.resolveAccountLoads(pool.map((b) => b.accountId));
    const priorityById = new Map(pool.map((b) => [b.accountId, b.priority]));
    const withPriority = loads.map((l) => ({ ...l, priority: priorityById.get(l.accountId) ?? 0 }));

    const chosen = selectAccount(withPriority, { modelScope: options.modelScope, now });
    return chosen ? { accountId: chosen.accountId, reason: 'balanced' } : null;
  };
}
