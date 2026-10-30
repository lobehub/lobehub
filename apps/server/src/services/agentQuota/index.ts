import {
  type AccountLoad,
  calibrateCapacity,
  type ClaudeCodeAccountRouting,
  type ClaudeCodeRoutedAccount,
  computeTurnCostUsd,
  currentUtilization,
  isScopedWeeklyLimit,
  isSessionLimit,
  isWeeklyAllLimit,
  type KimiCodeExtraUsage,
  MIN_CALIBRATION_SAMPLES,
  projectWindows,
  type QuotaAccountIdentity,
  type QuotaLimitReading,
  type QuotaTokenUsage,
  rankAccounts,
  selectAccount,
  windowSecondsForKind,
  windowsToCalibrationIntervals,
} from '@lobechat/heterogeneous-agents/quota';

import type { AccountIdentityInput, SafeAccount } from '@/database/models/agentQuota';
import {
  AgentAccountBindingModel,
  AgentDeviceAccountBindingModel,
  AgentProviderAccountLoginModel,
  AgentProviderAccountModel,
  AgentQuotaCalibrationModel,
  AgentQuotaSnapshotModel,
  AgentQuotaUsageLedgerModel,
  AgentQuotaWindowModel,
} from '@/database/models/agentQuota';
import { DeviceModel } from '@/database/models/device';
import type { LobeChatDatabase } from '@/database/type';
import {
  type QuotaAccountCredentialRef,
  QuotaBindingRole,
  QuotaCostSource,
  QuotaCredentialMode,
} from '@/database/types/agentQuota';

import { claudeModelPrice, codexModelPrice } from './pricing';
import { resolveDeviceRowId } from './resolveDeviceRowId';

const readQuotaWindowMetadata = (raw: Record<string, unknown> | null) => ({
  ...(typeof raw?.windowMinutes === 'number' &&
  Number.isFinite(raw.windowMinutes) &&
  raw.windowMinutes > 0
    ? { windowMinutes: raw.windowMinutes }
    : {}),
  ...(typeof raw?.limitName === 'string' || raw?.limitName === null
    ? { limitName: raw.limitName }
    : {}),
});

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
interface SelectAccountOptions {
  /**
   * `devices.id` of the machine the run spawns on. Its own account choice
   * (`agent_device_account_bindings`) wins over the agent-wide pin.
   */
  deviceId?: string;
  modelScope?: string;
  now?: number;
  provider?: string;
  /**
   * Provider account ids the caller holds a local login for. Auto mode only
   * balances across these, and an agent-wide pin outside them is skipped (it
   * was chosen on another machine); omitted = every account is runnable.
   */
  runnableExternalAccountIds?: string[];
}

/** How recently a run must have billed an account to count as running on it. */
const ACTIVE_RUN_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Postgres `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';

/** The (account, device) pair of a device account choice is not a recorded login. */
export class AccountNotSignedInOnDeviceError extends Error {
  constructor() {
    super('The account is not signed in on this device');
    this.name = 'AccountNotSignedInOnDeviceError';
  }
}

const isForeignKeyViolation = (error: unknown): boolean => {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return true;
  }
  return false;
};

/** Where a pin came from: the run's own device, or the legacy agent-wide pin. */
export type AccountPinScope = 'agent' | 'device';

export class AgentQuotaService {
  private accounts: AgentProviderAccountModel;
  private bindings: AgentAccountBindingModel;
  private deviceBindings: AgentDeviceAccountBindingModel;
  private devices: DeviceModel;
  private logins: AgentProviderAccountLoginModel;
  private workspaceId?: string;
  private snapshots: AgentQuotaSnapshotModel;
  private ledger: AgentQuotaUsageLedgerModel;
  private windows: AgentQuotaWindowModel;
  private calibrations: AgentQuotaCalibrationModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.accounts = new AgentProviderAccountModel(db, userId, workspaceId);
    this.bindings = new AgentAccountBindingModel(db, userId, workspaceId);
    this.deviceBindings = new AgentDeviceAccountBindingModel(db, userId, workspaceId);
    this.devices = new DeviceModel(db, userId, workspaceId);
    this.logins = new AgentProviderAccountLoginModel(db, userId, workspaceId);
    this.workspaceId = workspaceId;
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
    extraUsage?: KimiCodeExtraUsage | null;
    identity: QuotaAccountIdentity;
    provider: string;
    readings: QuotaLimitReading[];
  }): Promise<SafeAccount> => {
    const account = await this.accounts.upsertByIdentity(
      params.provider,
      params.identity as AccountIdentityInput,
      params.credentialRef ? { credentialRef: params.credentialRef } : {},
    );
    // The wallet is not a limit reading, so it can't ride the snapshots table —
    // keep the latest sample on the account row or the persisted view loses the
    // Extra Usage section between live samples.
    if (params.extraUsage !== undefined) {
      await this.accounts.update(account.id, {
        metadata: { ...account.metadata, extraUsage: params.extraUsage },
      });
    }
    // A sample read on a device proves the account is signed in there.
    if (params.deviceId) await this.logins.record(account.id, params.deviceId);
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
        raw: { windowMinutes: r.windowMinutes, limitName: r.limitName },
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
        windowSeconds: list[0]?.windowSeconds ?? windowSecondsForKind(limitType),
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
      ? ((await this.accounts.findByExternalId(params.provider, params.externalAccountId)) ??
        // A first-run turn can arrive before any snapshot ingestion created the
        // account row. Create it here or the turn is permanently unattributed —
        // later snapshot ingestion does not backfill existing ledger rows. The
        // remaining identity fields are enriched by the next snapshot upsert.
        (await this.accounts.upsertByIdentity(params.provider, {
          externalAccountId: params.externalAccountId,
        })))
      : null;

    const price = params.model
      ? params.provider === 'codex'
        ? codexModelPrice(params.model)
        : claudeModelPrice(params.model)
      : null;
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
      ...readQuotaWindowMetadata(row.raw),
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
      ...readQuotaWindowMetadata(row.raw),
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

  /**
   * Agent runs still in flight on an account. Only runs that billed it within
   * the last few hours count: an operation left `running` by a crashed client
   * would otherwise stay listed forever.
   */
  listActiveRuns = async (accountId: string, now: number = Date.now()) => {
    const rows = await this.ledger.listActiveRuns(accountId, new Date(now - ACTIVE_RUN_WINDOW_MS));

    return rows.map((row) => ({
      ...row,
      lastTurnAt: row.lastTurnAt.getTime(),
      startedAt: row.startedAt?.getTime() ?? null,
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

  /** `devices.id` of a device known by its gateway id; see `resolveDeviceRowId`. */
  resolveDeviceRowId = (gatewayDeviceId?: string): Promise<string | undefined> =>
    resolveDeviceRowId(this.devices, this.workspaceId, gatewayDeviceId);

  /**
   * Pick the account an agent should run on, in this order:
   *
   * 1. the agent's account choice on the run's device (`deviceId`);
   * 2. the agent-wide pin, unless the caller says it cannot run it here
   *    (`runnableExternalAccountIds`) — such a pin was picked on another
   *    machine, so this one balances instead of failing on it;
   * 3. the pool, ranked weekly-headroom-first, scope-aware.
   *
   * Returns the credential pointer alongside so the spawn side can act on the
   * choice (set `CLAUDE_CONFIG_DIR` for a config-dir profile, leave the default
   * login for keychain) without a second round-trip.
   */
  selectForAgent = async (
    agentId: string,
    options: SelectAccountOptions = {},
  ): Promise<{
    accountId: string;
    credentialMode: string;
    credentialRef: QuotaAccountCredentialRef | null;
    externalAccountId: string | null;
    pinScope?: AccountPinScope;
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
      ...(chosen.pinScope && { pinScope: chosen.pinScope }),
      reason: chosen.reason,
    };
  };

  /** The account an agent is set to use on one device; `null` = Auto there. */
  getDeviceAccount = async (agentId: string, deviceId: string): Promise<string | null> =>
    (await this.deviceBindings.find(agentId, deviceId))?.accountId ?? null;

  /**
   * Set (or clear, with `null`) the account an agent uses on one device.
   *
   * An agent-wide pin left over from before choices were per device is first
   * handed to every device that holds a login for it, then demoted to the
   * pool: from here on each device keeps its own choice, so changing this
   * device neither moves the others nor stays overridden by the old pin.
   *
   * Throws `AccountNotSignedInOnDeviceError` when the device holds no recorded
   * login for the account.
   */
  setDeviceAccount = async (
    agentId: string,
    deviceId: string,
    accountId: string | null,
  ): Promise<void> => {
    await this.retireAgentPin(agentId);

    if (!accountId) {
      await this.deviceBindings.clear(agentId, deviceId);
      return;
    }

    try {
      await this.deviceBindings.set(agentId, deviceId, accountId);
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new AccountNotSignedInOnDeviceError();
      throw error;
    }
  };

  /**
   * Replace the logins recorded for one provider on a device with the ones it
   * reports now. Accounts it no longer lists lose their login there, and with
   * it any device account choice made on them (FK cascade). Accounts without
   * a row in this scope are ignored: ingestion creates them first.
   */
  syncDeviceLogins = async (
    deviceId: string,
    provider: string,
    externalAccountIds: string[],
  ): Promise<void> => {
    const accounts = (await this.accounts.list()).filter((a) => a.provider === provider);
    const present = new Set(externalAccountIds);
    const signedInIds = new Set(
      accounts
        .filter((a) => a.externalAccountId && present.has(a.externalAccountId))
        .map((a) => a.id),
    );

    await Promise.all([...signedInIds].map((accountId) => this.logins.record(accountId, deviceId)));

    const providerIds = new Set(accounts.map((a) => a.id));
    const recorded = await this.logins.listByDevice(deviceId);
    await this.logins.removeOnDevice(
      deviceId,
      recorded
        .map((login) => login.accountId)
        .filter((id) => providerIds.has(id) && !signedInIds.has(id)),
    );
  };

  /**
   * The account choice for a run on an execution device, which picks the
   * login itself (only it knows which accounts it is signed in to): the pin,
   * or the whole eligible pool best-first. `null` = no routing, and the device
   * spawns on its default login as before.
   *
   * Only `referenced` accounts map to a device login; a run pinned to any
   * other account keeps the default login, as on the desktop.
   *
   * With the run's `deviceId`, that device's own choice is the pin. A legacy
   * agent-wide pin stays strict only where its login is recorded; elsewhere
   * it was picked on another machine, so it becomes the first Auto candidate
   * and the device falls through to the pool (or its default login).
   */
  planDeviceRouting = async (
    agentId: string,
    options: Pick<SelectAccountOptions, 'deviceId' | 'modelScope' | 'now' | 'provider'> = {},
  ): Promise<ClaudeCodeAccountRouting | null> => {
    const bindings = await this.enabledBindings(agentId, options.provider);
    const accounts = new Map((await this.accounts.list()).map((a) => [a.id, a]));
    const routed = (accountId: string): ClaudeCodeRoutedAccount | undefined => {
      const account = accounts.get(accountId);
      if (account?.credentialMode !== QuotaCredentialMode.referenced) return;
      if (!account.externalAccountId) return;
      const name = account.label || account.email;
      return { externalAccountId: account.externalAccountId, ...(name ? { name } : {}) };
    };

    const deviceChoice = await this.deviceChoiceOf(agentId, bindings, options.deviceId);
    if (deviceChoice) {
      const account = routed(deviceChoice);
      return account ? { candidates: [account], mode: 'pinned' } : null;
    }

    const pinned = bindings.find((b) => b.role === QuotaBindingRole.pinned);
    let pinnedElsewhere: ClaudeCodeRoutedAccount | undefined;
    if (pinned) {
      const account = routed(pinned.accountId);
      if (!account) return null;
      const strict =
        !options.deviceId ||
        (await this.logins.listByAccount(pinned.accountId)).some(
          (login) => login.deviceId === options.deviceId,
        );
      if (strict) return { candidates: [account], mode: 'pinned' };
      pinnedElsewhere = account;
    }

    const pool = bindings.filter((b) => b.role === QuotaBindingRole.pool);
    if (pool.length === 0)
      return pinnedElsewhere ? { candidates: [pinnedElsewhere], mode: 'balanced' } : null;

    const now = options.now ?? Date.now();
    const priorityById = new Map(pool.map((b) => [b.accountId, b.priority]));
    const loads = await this.resolveAccountLoads(
      pool.map((b) => b.accountId),
      now,
    );
    const candidates = rankAccounts(
      loads.map((l) => ({ ...l, priority: priorityById.get(l.accountId) ?? 0 })),
      { modelScope: options.modelScope, now },
    ).flatMap((load) => routed(load.accountId) ?? []);
    if (pinnedElsewhere)
      candidates.splice(
        0,
        0,
        ...[pinnedElsewhere].filter(
          (account) => !candidates.some((c) => c.externalAccountId === account.externalAccountId),
        ),
      );

    return candidates.length > 0 ? { candidates, mode: 'balanced' } : null;
  };

  /**
   * The account the agent's choice on `deviceId` names, while it is still in
   * the agent's rotation (an account since dropped or disabled no longer
   * counts). `bindings` are the agent's enabled bindings for the provider.
   */
  private deviceChoiceOf = async (
    agentId: string,
    bindings: { accountId: string; role: string }[],
    deviceId?: string,
  ): Promise<string | undefined> => {
    if (!deviceId) return;
    const choice = await this.deviceBindings.find(agentId, deviceId);
    if (!choice) return;
    const usable = bindings.some(
      (b) => b.accountId === choice.accountId && b.role !== QuotaBindingRole.disabled,
    );
    return usable ? choice.accountId : undefined;
  };

  /** Move a legacy agent-wide pin onto the devices that can run it, then demote it. */
  private retireAgentPin = async (agentId: string) => {
    const pinned = (await this.bindings.listByAgent(agentId)).find(
      (b) => b.role === QuotaBindingRole.pinned,
    );
    if (!pinned) return;

    const [logins, chosen] = await Promise.all([
      this.logins.listByAccount(pinned.accountId),
      this.deviceBindings.listByAgent(agentId),
    ]);
    const decided = new Set(chosen.map((b) => b.deviceId));
    await Promise.all(
      logins
        .filter((login) => !decided.has(login.deviceId))
        .map((login) => this.deviceBindings.set(agentId, login.deviceId, pinned.accountId)),
    );
    await this.bindings.upsert({
      accountId: pinned.accountId,
      agentId,
      enabled: pinned.enabled,
      priority: pinned.priority,
      role: QuotaBindingRole.pool,
      weight: pinned.weight,
    });
  };

  /**
   * The agent's enabled bindings. Bindings are written provider-blind; a
   * caller that names its provider must never be routed onto another
   * provider's account, pinned or pooled.
   */
  private enabledBindings = async (agentId: string, provider?: string) => {
    const bindings = (await this.bindings.listByAgent(agentId)).filter((b) => b.enabled);
    if (!provider) return bindings;

    // One read of the caller's accounts rather than a lookup per binding.
    const providerById = new Map((await this.accounts.list()).map((a) => [a.id, a.provider]));
    return bindings.filter((binding) => providerById.get(binding.accountId) === provider);
  };

  private selectAccountId = async (
    agentId: string,
    options: SelectAccountOptions,
  ): Promise<{
    accountId: string;
    pinScope?: AccountPinScope;
    reason: 'pinned' | 'balanced';
  } | null> => {
    const bindings = await this.enabledBindings(agentId, options.provider);

    // The device's own choice is returned even when the caller cannot run it:
    // the caller must say so rather than quietly run another account.
    const deviceChoice = await this.deviceChoiceOf(agentId, bindings, options.deviceId);
    if (deviceChoice) return { accountId: deviceChoice, pinScope: 'device', reason: 'pinned' };

    let canRun = (_accountId: string) => true;
    if (options.runnableExternalAccountIds) {
      const runnable = new Set(options.runnableExternalAccountIds);
      // One read of the caller's accounts rather than a lookup per binding.
      const externalIdById = new Map(
        (await this.accounts.list()).map((account) => [account.id, account.externalAccountId]),
      );
      canRun = (accountId) => {
        const externalId = externalIdById.get(accountId);
        return !!externalId && runnable.has(externalId);
      };
    }

    // A legacy agent-wide pin the caller cannot run was picked on another
    // machine: balance here instead of failing on it.
    const pinned = bindings.find((b) => b.role === QuotaBindingRole.pinned);
    if (pinned && canRun(pinned.accountId))
      return { accountId: pinned.accountId, pinScope: 'agent', reason: 'pinned' };

    // Auto mode may only land on an account the caller can actually run.
    const pool = bindings.filter((b) => b.role === QuotaBindingRole.pool && canRun(b.accountId));
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
