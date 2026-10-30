import { isDesktop } from '@lobechat/const';
import type { ClaudeCodeLocalAccount } from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import { agentQuotaService } from '@/services/agentQuota';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { getElectronStoreState } from '@/store/electron';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';

import { initialState, type State } from './initialState';
import {
  hashQuotaSourceKey,
  parseQuotaDeviceAccountKey,
  QUOTA_ACCOUNTS_KEY,
  QUOTA_HISTORY_DAYS,
  QUOTA_HISTORY_WINDOW_LIMIT,
  type QuotaAccount,
  quotaAccountsResource,
  type QuotaBinding,
  quotaBindingsResource,
  type QuotaDeviceAccount,
  quotaDeviceAccountKey,
  quotaDeviceAccountResource,
  type QuotaHistory,
  type QuotaHistoryFetched,
  quotaHistoryResource,
  type QuotaLatestReading,
  quotaPanelResource,
  type QuotaPanelSnapshot,
  quotaReadingsResource,
  toPersistedQuotaAccounts,
  toPersistedQuotaPanel,
} from './projection';

export type Action = Pick<ActionImpl, keyof ActionImpl>;
export type Store = State & Action;

type Setter = StoreSetter<Store>;

/**
 * Panels, the account manager and the calendar all read the same account list
 * and readings. A read inside this window answers from the replica instead of
 * sending another request; writes and explicit refreshes pass `fresh`.
 */
export const QUOTA_READ_DEDUPE_MS = 10_000;

type QuotaResourceName = 'accounts' | 'bindings' | 'deviceAccount' | 'history' | 'readings';

interface ReadOptions {
  /** Skip the dedupe window and retire older requests (after a write / ingest). */
  fresh?: boolean;
}

/** Where a settled server answer was captured (`ReplicaEffects` context). */
interface SettleContext {
  key: string;
  scope: string;
}

export const quotaConfirmedKey = (scope: string, resource: QuotaResourceName, key: string) =>
  `${scope}|${resource}|${key}`;

const sameValue = <T>(incoming: T, confirmed: T | undefined) =>
  isEqual(incoming, confirmed) ? undefined : incoming;

const upsertBinding = (bindings: QuotaBinding[], row: QuotaBinding) =>
  bindings.some((binding) => binding.id === row.id || binding.accountId === row.accountId)
    ? bindings.map((binding) =>
        binding.id === row.id || binding.accountId === row.accountId ? row : binding,
      )
    : [...bindings, row];

/**
 * Agent quota (coding agent subscription accounts): the account pool, each
 * agent's bindings, each account's newest readings and calendar history, plus
 * the last snapshot every quota panel rendered. All of it paints from the
 * local replica on a reload and converges on the server in the background.
 */
export class ActionImpl {
  readonly #get: () => Store;
  readonly #set: Setter;
  readonly #accounts;
  readonly #bindings;
  readonly #deviceAccount;
  readonly #readings;
  readonly #history;
  readonly #panel;
  /** When each `<scope>|<resource>|<key>` last applied a server answer. */
  readonly #appliedAt = new Map<string, number>();
  /** Advanced by every `reset()`, so a live panel sample from before it is dropped. */
  #resetGeneration = 0;

  constructor(set: Setter, get: () => Store, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;

    const confirmOn = (resource: QuotaResourceName) => ({
      onApplied: (_data: unknown, _params: unknown, context: SettleContext) =>
        this.#markApplied(resource, context),
    });

    this.#accounts = createReplicaSlice(quotaAccountsResource, {
      actionPrefix: 'quotaAccounts',
      effects: confirmOn('accounts'),
      fetcher: () => agentQuotaService.listAccounts(),
      get,
      merge: sameValue,
      set,
      stateKey: 'quotaAccountsReplica',
      toPersisted: toPersistedQuotaAccounts,
      view: recordLens<Store, QuotaAccount[]>('quotaAccountsMap'),
    });
    this.#bindings = createReplicaSlice(quotaBindingsResource, {
      actionPrefix: 'quotaBindings',
      effects: confirmOn('bindings'),
      fetcher: (agentId) => agentQuotaService.listBindings(agentId),
      get,
      merge: sameValue,
      set,
      stateKey: 'quotaBindingsReplica',
      view: recordLens<Store, QuotaBinding[]>('quotaBindingsMap'),
    });
    this.#deviceAccount = createReplicaSlice(quotaDeviceAccountResource, {
      actionPrefix: 'quotaDeviceAccount',
      effects: confirmOn('deviceAccount'),
      fetcher: (key) => {
        const { agentId, deviceId } = parseQuotaDeviceAccountKey(key);
        return agentQuotaService.getDeviceAccount(agentId, deviceId);
      },
      get,
      merge: sameValue,
      set,
      stateKey: 'quotaDeviceAccountReplica',
      view: recordLens<Store, QuotaDeviceAccount>('quotaDeviceAccountMap'),
    });
    this.#readings = createReplicaSlice(quotaReadingsResource, {
      actionPrefix: 'quotaReadings',
      effects: confirmOn('readings'),
      fetcher: (accountId) => agentQuotaService.getLatestReadings(accountId),
      get,
      merge: sameValue,
      set,
      stateKey: 'quotaReadingsReplica',
      view: recordLens<Store, QuotaLatestReading[]>('quotaReadingsMap'),
    });
    this.#history = createReplicaSlice(quotaHistoryResource, {
      actionPrefix: 'quotaHistory',
      effects: confirmOn('history'),
      fetcher: async (accountId): Promise<QuotaHistoryFetched> => {
        const [windows, snapshots, usageTurns] = await Promise.allSettled([
          agentQuotaService.getWindows(accountId, QUOTA_HISTORY_WINDOW_LIMIT),
          agentQuotaService.listSnapshots(accountId, QUOTA_HISTORY_DAYS),
          agentQuotaService.listUsageTurns(accountId, QUOTA_HISTORY_DAYS),
        ]);
        // Nothing answered: fail the refresh so the last history stays on screen.
        if ([windows, snapshots, usageTurns].every((result) => result.status === 'rejected'))
          throw (windows as PromiseRejectedResult).reason;
        // A part that failed stays `undefined`; `merge` keeps its last confirmed value.
        return {
          snapshots: snapshots.status === 'fulfilled' ? snapshots.value : undefined,
          usageTurns: usageTurns.status === 'fulfilled' ? usageTurns.value : undefined,
          windows: windows.status === 'fulfilled' ? windows.value : undefined,
        };
      },
      get,
      // One part failing keeps the parts that answered, and that part's last
      // confirmed value (or nothing on a first read).
      merge: (incoming, confirmed) =>
        sameValue<QuotaHistory>(
          {
            snapshots: incoming.snapshots ?? confirmed?.snapshots ?? [],
            usageTurns: incoming.usageTurns ?? confirmed?.usageTurns ?? [],
            windows: incoming.windows ?? confirmed?.windows ?? [],
          },
          confirmed,
        ),
      set,
      stateKey: 'quotaHistoryReplica',
      view: recordLens<Store, QuotaHistory>('quotaHistoryMap'),
    });
    this.#panel = createReplicaSlice(quotaPanelResource, {
      actionPrefix: 'quotaPanel',
      get,
      set,
      stateKey: 'quotaPanelReplica',
      toPersisted: toPersistedQuotaPanel,
      view: recordLens<Store, QuotaPanelSnapshot>('quotaPanelMap'),
    });
  }

  // ---- sync hooks (fetch orchestration only; data comes from selectors) ----

  useFetchQuotaAccounts = (enabled = true): ReplicaSyncResult =>
    this.#accounts.useSync(
      enabled ? QUOTA_ACCOUNTS_KEY : null,
      this.#syncOptions('accounts', QUOTA_ACCOUNTS_KEY),
    );

  useFetchQuotaBindings = (agentId?: string | null): ReplicaSyncResult =>
    this.#bindings.useSync(agentId || null, this.#syncOptions('bindings', agentId));

  /** Sync one agent's account choice on one device (gateway id). */
  useFetchQuotaDeviceAccount = (
    agentId?: string | null,
    deviceId?: string | null,
  ): ReplicaSyncResult => {
    const key = agentId && deviceId ? quotaDeviceAccountKey(agentId, deviceId) : null;
    return this.#deviceAccount.useSync(key, this.#syncOptions('deviceAccount', key));
  };

  useFetchQuotaReadings = (accountId?: string | null): ReplicaSyncResult =>
    this.#readings.useSync(accountId || null, this.#syncOptions('readings', accountId));

  useFetchQuotaHistory = (accountId?: string | null): ReplicaSyncResult =>
    this.#history.useSync(accountId || null, this.#syncOptions('history', accountId));

  /**
   * Hydrate the last snapshot a quota panel rendered for `sourceKey`. The panel
   * samples live quota itself (desktop IPC / device RPC), so this replica has
   * no fetcher: it only paints from storage and persists what the panel writes
   * back through `setQuotaPanel`.
   */
  useHydrateQuotaPanel = (sourceKey: string): ReplicaSyncResult =>
    this.#panel.useSync(hashQuotaSourceKey(sourceKey));

  /**
   * The data context a panel sample is captured under: the identity (user +
   * workspace) plus the reset generation, since a desktop `refreshUserData` /
   * `disconnectRemoteServer` can change the context without changing the scope.
   */
  getQuotaContext = (): string => `${quotaPanelResource.scope.get()}\u0000${this.#resetGeneration}`;

  /** Record what a panel now shows; a sample started under another data context is dropped. */
  setQuotaPanel = (
    sourceKey: string,
    snapshot: QuotaPanelSnapshot,
    context = this.getQuotaContext(),
  ): void => {
    if (context !== this.getQuotaContext()) return;
    this.#panel.update(hashQuotaSourceKey(sourceKey), () => snapshot);
  };

  // ---- reads for the live samplers (no view mounted) ----

  readQuotaAccounts = (options?: ReadOptions): Promise<QuotaAccount[]> =>
    this.#read('accounts', this.#accounts, QUOTA_ACCOUNTS_KEY, 'quotaAccountsMap', options);

  readQuotaBindings = (agentId: string, options?: ReadOptions): Promise<QuotaBinding[]> =>
    this.#read('bindings', this.#bindings, agentId, 'quotaBindingsMap', options);

  readQuotaDeviceAccount = (
    agentId: string,
    deviceId: string,
    options?: ReadOptions,
  ): Promise<QuotaDeviceAccount> =>
    this.#read(
      'deviceAccount',
      this.#deviceAccount,
      quotaDeviceAccountKey(agentId, deviceId),
      'quotaDeviceAccountMap',
      options,
    );

  /**
   * A `fresh` readings read follows an ingest (local, device-side or a reset),
   * which also appended to the account's snapshot series and windows: refresh a
   * loaded calendar history too instead of leaving it a dedupe window behind.
   */
  readQuotaReadings = (accountId: string, options?: ReadOptions): Promise<QuotaLatestReading[]> => {
    if (options?.fresh && this.#get().quotaHistoryMap[accountId] !== undefined)
      void this.#refresh(this.#history, accountId);
    return this.#read('readings', this.#readings, accountId, 'quotaReadingsMap', options);
  };

  // ---- writes (account manager) ----

  /** Pin one account for an agent (Manual mode); any previous pin drops back to the pool. */
  switchQuotaAccount = async (agentId: string, accountId: string): Promise<void> => {
    const loading = this.#ensureBindings(agentId);
    if (loading) await loading;
    await this.#bindings.optimistic(
      agentId,
      (bindings) =>
        bindings.map((binding) =>
          binding.accountId === accountId
            ? { ...binding, role: 'pinned' }
            : binding.role === 'pinned'
              ? { ...binding, role: 'pool' }
              : binding,
        ),
      () => agentQuotaService.switchAccount(agentId, accountId),
    );
    await this.#refresh(this.#bindings, agentId);
  };

  /**
   * Pin an account for an agent on one device (Manual mode there), or return
   * that device to Auto with `null`. The server first hands a legacy
   * agent-wide pin to the devices that hold its login, so the bindings change
   * too and are re-read.
   */
  setQuotaDeviceAccount = async (
    agentId: string,
    deviceId: string,
    accountId: string | null,
  ): Promise<void> => {
    const key = quotaDeviceAccountKey(agentId, deviceId);
    if (this.#get().quotaDeviceAccountMap[key] === undefined)
      await this.readQuotaDeviceAccount(agentId, deviceId);
    await this.#deviceAccount.optimistic(
      key,
      () => ({ accountId }),
      () => agentQuotaService.setDeviceAccount(agentId, deviceId, accountId),
    );
    await Promise.all([
      this.#refresh(this.#deviceAccount, key),
      this.#refresh(this.#bindings, agentId),
    ]);
  };

  /** Add an account to an agent's pool, or change its role there. */
  bindQuotaAccount = async (
    agentId: string,
    accountId: string,
    role: 'pinned' | 'pool' | 'disabled',
  ): Promise<void> => {
    const loading = this.#ensureBindings(agentId);
    if (loading) await loading;
    await this.#bindings.optimistic(
      agentId,
      (bindings) =>
        bindings.map((binding) =>
          binding.accountId === accountId ? { ...binding, role } : binding,
        ),
      () => agentQuotaService.bindAccount(agentId, accountId, role),
      {
        // The upserted row is the confirmed value, also for an account that had no binding yet.
        confirm: (row) => (bindings) => (row ? upsertBinding(bindings, row) : bindings),
      },
    );
    await this.#refresh(this.#bindings, agentId);
  };

  /** Drop an account from an agent's pool; the row leaves the replica and its stored copy. */
  unbindQuotaAccount = async (agentId: string, bindingId: string): Promise<void> => {
    const loading = this.#ensureBindings(agentId);
    if (loading) await loading;
    await this.#bindings.optimistic(
      agentId,
      (bindings) => bindings.filter((binding) => binding.id !== bindingId),
      () => agentQuotaService.unbindAccount(bindingId),
    );
    await this.#refresh(this.#bindings, agentId);
  };

  /** Rename an account (an empty label falls back to its email / external id). */
  renameQuotaAccount = async (accountId: string, label: string | undefined): Promise<void> => {
    await this.#accounts.optimistic(
      QUOTA_ACCOUNTS_KEY,
      (accounts) =>
        accounts.map((account) =>
          account.id === accountId ? { ...account, label: label ?? null } : account,
        ),
      () => agentQuotaService.updateAccount(accountId, { label }),
    );
    await this.#refresh(this.#accounts, QUOTA_ACCOUNTS_KEY);
  };

  /**
   * Take an account in or out of the workspace's rotation. A disabled account
   * stays listed (and keeps its history) but the load balancer skips it.
   */
  setQuotaAccountEnabled = async (accountId: string, enabled: boolean): Promise<void> => {
    await this.#accounts.optimistic(
      QUOTA_ACCOUNTS_KEY,
      (accounts) =>
        accounts.map((account) => (account.id === accountId ? { ...account, enabled } : account)),
      () => agentQuotaService.updateAccount(accountId, { enabled }),
    );
    await this.#refresh(this.#accounts, QUOTA_ACCOUNTS_KEY);
  };

  // ---- local Claude Code logins (desktop) ----

  /**
   * The Claude logins this desktop holds. Listing also samples each login's
   * quota into the pool: the quota panel only samples the login it shows, Auto
   * mode can only balance on readings that exist, and a login whose usage call
   * fails (e.g. a blocked network) must still show up as an account.
   */
  useFetchClaudeLocalAccounts = (enabled = true): SWRResponse<ClaudeCodeLocalAccount[]> =>
    useClientDataSWR(
      enabled ? electronKeys.claudeCodeAccounts() : null,
      () => this.#syncClaudeLocalAccounts(),
      {
        onSuccess: (claudeLocalAccounts: ClaudeCodeLocalAccount[]) =>
          this.#set({ claudeLocalAccounts }, false, 'claudeLocalAccounts'),
        revalidateOnFocus: false,
      },
    );

  /**
   * Sample every local login into the pool now, without a view mounted. The
   * quota panel calls this on its refresh: in Auto mode runs may land on any
   * local profile, and balancing reads these readings, so they must not go
   * stale while the account manager is closed.
   */
  refreshClaudeLocalAccounts = async (): Promise<void> => {
    const claudeLocalAccounts = await this.#syncClaudeLocalAccounts();
    this.#set({ claudeLocalAccounts }, false, 'claudeLocalAccounts');
  };

  /**
   * Sign an account in to this desktop through the browser (`claude auth
   * login` in a profile of its own), then add it to the pool.
   */
  loginClaudeAccount = async (email?: string): Promise<ClaudeCodeLocalAccount> => {
    this.#set({ claudeLoginPending: true }, false, 'claudeLoginPending');
    try {
      const account = await heterogeneousAgentService.loginClaudeCodeAccount(
        email ? { email } : undefined,
      );
      await this.#ingestLocalLogin(account, true).catch(() => false);
      await mutate(electronKeys.claudeCodeAccounts());
      await this.#refresh(this.#accounts, QUOTA_ACCOUNTS_KEY);
      return account;
    } finally {
      this.#set({ claudeLoginPending: false }, false, 'claudeLoginPending');
    }
  };

  /** Abort the browser sign-in in progress; `loginClaudeAccount` then rejects. */
  cancelClaudeAccountLogin = async (): Promise<void> => {
    await heterogeneousAgentService.cancelClaudeCodeAccountLogin();
  };

  /**
   * Drop every quota view and confirmation when the data context changes
   * (desktop `refreshUserData` / `disconnectRemoteServer`), even when the next
   * context derives the same scope string.
   * `clear()` advances each replica's clear generation, so a read still in
   * flight from the previous context is discarded instead of repopulating (and
   * persisting) what was just dropped; it also deletes that context's rows.
   * Mounted syncs then refetch from empty.
   */
  reset = (): void => {
    // A mounted manager / calendar keeps its sync key across the reset, so
    // nothing would refetch until a focus or remount: revalidate once cleared.
    for (const slice of [
      this.#accounts,
      this.#bindings,
      this.#deviceAccount,
      this.#readings,
      this.#history,
    ])
      void slice.clear().then(() => slice.revalidate());
    void this.#panel.clear();
    this.#appliedAt.clear();
    // Live panel samples are not replica fetches, so `clear()` cannot retire them.
    this.#resetGeneration += 1;
    this.#set({ ...initialState }, false, 'resetAgentQuotaStore');
    // Local logins outlive the data context, but their accounts must land in
    // the new context's pool: list (and ingest) them again.
    if (isDesktop) void mutate(electronKeys.claudeCodeAccounts()).catch(() => {});
  };

  // ---- internals ----

  #syncClaudeLocalAccounts = async (): Promise<ClaudeCodeLocalAccount[]> => {
    const accounts = await heterogeneousAgentService.listClaudeCodeAccounts();
    const ingested = await Promise.all(
      accounts.map((account) => this.#ingestLocalLogin(account).catch(() => false)),
    );
    if (ingested.some(Boolean)) await this.#refresh(this.#accounts, QUOTA_ACCOUNTS_KEY);
    // Record which logins this machine holds, so a per-device account choice
    // can only name one it can run (and a signed-out one stops counting).
    const deviceId = await getElectronStoreState().resolveGatewayDeviceId();
    if (deviceId)
      await agentQuotaService
        .syncDeviceLogins(
          deviceId,
          'claude-code',
          accounts.flatMap((account) => account.identity.externalAccountId ?? []),
        )
        .catch((error) => console.error('[agentQuota:syncDeviceLogins]', error));
    return accounts;
  };

  /**
   * Sample one local login and persist it. A login whose usage call fails still
   * registers its account (no readings), so a fresh sign-in always shows up.
   * Returns whether anything new reached the server.
   */
  #ingestLocalLogin = async (account: ClaudeCodeLocalAccount, force = false): Promise<boolean> => {
    const live = await heterogeneousAgentService
      .getClaudeCodeQuota({
        ...(account.configDir && { env: { CLAUDE_CONFIG_DIR: account.configDir } }),
        ...(force && { force: true }),
      })
      .catch(() => null);
    const identity = live?.identity ?? account.identity;
    const readings = live?.status === 'ok' ? (live.readings ?? []) : [];

    const known = (await this.readQuotaAccounts().catch(() => [])).find(
      (row) => row.externalAccountId === identity.externalAccountId,
    );
    if (known) {
      if (readings.length === 0) return false;
      // The main-process cache echoes a sample already persisted (same
      // capturedAt); snapshots are append-only, so never ingest it twice.
      const persisted = await this.readQuotaReadings(known.id).catch(() => []);
      const newest = (rows: { capturedAt: number }[]) =>
        rows.reduce((max, row) => Math.max(max, row.capturedAt), 0);
      if (newest(readings) <= newest(persisted)) return false;
    }

    await agentQuotaService.ingestClaudeSnapshot({ identity, readings });
    if (known) await this.readQuotaReadings(known.id, { fresh: true }).catch(() => []);
    return true;
  };

  /**
   * A sampler read (`readQuota*`) seeds the sync cache, but SWR still
   * revalidates a seeded entry on mount: a panel opened right after the menu
   * sampled would send the same request again. Inside the dedupe window of a
   * server answer, mount from the replica instead; explicit, post-write and
   * later mounts refresh as usual.
   */
  #syncOptions = (resource: QuotaResourceName, key?: string | null) => {
    const appliedAt = key
      ? this.#appliedAt.get(quotaConfirmedKey(quotaAccountsResource.scope.get(), resource, key))
      : undefined;
    const recent = appliedAt !== undefined && Date.now() - appliedAt < QUOTA_READ_DEDUPE_MS;
    return {
      dedupingInterval: QUOTA_READ_DEDUPE_MS,
      revalidateOnFocus: false,
      ...(recent && { revalidateIfStale: false }),
    };
  };

  /**
   * An optimistic write (and its confirmation) only lands on a loaded view, so
   * load the agent's bindings first: a write made while the persisted accounts
   * already painted but the bindings read is still out would otherwise reach
   * the server and never reach the replica. A loaded view returns nothing, so
   * the optimistic update still paints in the same tick as the click.
   */
  #ensureBindings = (agentId: string): Promise<unknown> | undefined =>
    this.#get().quotaBindingsMap[agentId] === undefined
      ? this.readQuotaBindings(agentId)
      : undefined;

  #markApplied = (resource: QuotaResourceName, { key, scope }: SettleContext) => {
    const id = quotaConfirmedKey(scope, resource, key);
    this.#appliedAt.set(id, Date.now());
    if (this.#get().quotaConfirmed[id]) return;
    this.#set(
      (state) => ({ quotaConfirmed: { ...state.quotaConfirmed, [id]: true } }),
      false,
      'quotaConfirmed',
    );
  };

  /** Re-read an entry after a write; the optimistic value already holds if it fails. */
  #refresh = async (
    slice: { fetch: (params: string, options?: ReadOptions) => Promise<unknown> },
    key: string,
  ) => {
    try {
      await slice.fetch(key, { fresh: true });
    } catch (error) {
      console.error('[agentQuota:refresh]', error);
    }
  };

  #read = async <T>(
    resource: QuotaResourceName,
    slice: {
      ensureScope: (scope: string) => void;
      fetch: (params: string, options?: ReadOptions) => Promise<{ applied: boolean; data: T }>;
    },
    key: string,
    field: 'quotaAccountsMap' | 'quotaBindingsMap' | 'quotaDeviceAccountMap' | 'quotaReadingsMap',
    { fresh = false }: ReadOptions = {},
    retried = false,
  ): Promise<T> => {
    const scope = quotaAccountsResource.scope.get();
    // The samplers read with no view mounted: drop a previous identity's
    // entries first, so neither the dedupe nor the failure fallback below can
    // answer with them.
    slice.ensureScope(scope);
    const cached = (this.#get()[field] as Record<string, T>)[key];
    const appliedAt = this.#appliedAt.get(quotaConfirmedKey(scope, resource, key));
    if (
      !fresh &&
      cached !== undefined &&
      appliedAt !== undefined &&
      Date.now() - appliedAt < QUOTA_READ_DEDUPE_MS
    )
      return cached;

    let result: { applied: boolean; data: T };
    try {
      result = await slice.fetch(key, fresh ? { fresh: true } : undefined);
    } catch (error) {
      // A failed refresh keeps answering with the last value the replica still
      // holds for this identity. Re-read it rather than reuse `cached`: a reset
      // may have cleared it, or a fresh read landed a newer value, meanwhile.
      const current = (this.#get()[field] as Record<string, T>)[key];
      if (current !== undefined && quotaAccountsResource.scope.get() === scope) return current;
      throw error;
    }
    if (result.applied) return result.data;

    // The replica dropped this answer: a write's `fresh` read superseded it, the
    // entry was removed, or the identity changed. Answer with what the replica
    // now holds (e.g. the switched pin) instead of the outdated response.
    const current = (this.#get()[field] as Record<string, T>)[key];
    if (current !== undefined && quotaAccountsResource.scope.get() === scope) return current;
    if (retried) throw new Error(`[agentQuota] ${resource} read for "${key}" was superseded`);
    return this.#read(resource, slice, key, field, { fresh: true }, true);
  };
}

export const store: StateCreator<Store> = (...parameters: Parameters<StateCreator<Store>>) => ({
  ...initialState,
  ...flattenActions<Action>([new ActionImpl(...parameters)]),
});
