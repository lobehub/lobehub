import type { ClaudeCodeLocalAccount } from '@lobechat/electron-client-ipc';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type {
  QuotaAccount,
  QuotaBinding,
  QuotaDeviceAccount,
  QuotaHistory,
  QuotaLatestReading,
  QuotaPanelSnapshot,
} from './projection';

export interface State {
  /**
   * Claude Code logins held on THIS desktop (default login + per-account
   * profiles). `undefined` until listed, and always on the web.
   */
  claudeLocalAccounts?: ClaudeCodeLocalAccount[];
  /** A browser sign-in started from the account manager is in progress. */
  claudeLoginPending: boolean;
  /** Replica view of the quota account list (one entry, `QUOTA_ACCOUNTS_KEY`). */
  quotaAccountsMap: Record<string, QuotaAccount[]>;
  /** Replica bookkeeping of `quotaAccountsMap`. */
  quotaAccountsReplica: ReplicaState<QuotaAccount[]>;
  /** Replica view of each agent's account bindings, keyed by agent id. */
  quotaBindingsMap: Record<string, QuotaBinding[]>;
  /** Replica bookkeeping of `quotaBindingsMap`. */
  quotaBindingsReplica: ReplicaState<QuotaBinding[]>;
  /**
   * Entries the server answered for in this session, keyed
   * `<scope>|<resource>|<key>`. A value hydrated from storage may be an empty
   * or outdated snapshot, so "no account" / "no history" is only shown once
   * the matching flag is set.
   */
  quotaConfirmed: Record<string, true>;
  /** Replica view of each agent's account choice per device, keyed `quotaDeviceAccountKey`. */
  quotaDeviceAccountMap: Record<string, QuotaDeviceAccount>;
  /** Replica bookkeeping of `quotaDeviceAccountMap`. */
  quotaDeviceAccountReplica: ReplicaState<QuotaDeviceAccount>;
  /** Replica view of each account's calendar history, keyed by account id. */
  quotaHistoryMap: Record<string, QuotaHistory>;
  /** Replica bookkeeping of `quotaHistoryMap`. */
  quotaHistoryReplica: ReplicaState<QuotaHistory>;
  /** Replica view of the last panel snapshot per quota source (hashed source key). */
  quotaPanelMap: Record<string, QuotaPanelSnapshot>;
  /** Replica bookkeeping of `quotaPanelMap`. */
  quotaPanelReplica: ReplicaState<QuotaPanelSnapshot>;
  /** Replica view of each account's newest readings, keyed by account id. */
  quotaReadingsMap: Record<string, QuotaLatestReading[]>;
  /** Replica bookkeeping of `quotaReadingsMap`. */
  quotaReadingsReplica: ReplicaState<QuotaLatestReading[]>;
}

export const initialState: State = {
  claudeLocalAccounts: undefined,
  claudeLoginPending: false,
  quotaAccountsMap: {},
  quotaAccountsReplica: createReplicaState(),
  quotaBindingsMap: {},
  quotaBindingsReplica: createReplicaState(),
  quotaConfirmed: {},
  quotaDeviceAccountMap: {},
  quotaDeviceAccountReplica: createReplicaState(),
  quotaHistoryMap: {},
  quotaHistoryReplica: createReplicaState(),
  quotaPanelMap: {},
  quotaPanelReplica: createReplicaState(),
  quotaReadingsMap: {},
  quotaReadingsReplica: createReplicaState(),
};
