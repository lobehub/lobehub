import { quotaConfirmedKey, type Store } from './action';
import { hashQuotaSourceKey, QUOTA_ACCOUNTS_KEY } from './projection';

const accounts = (s: Store) => s.quotaAccountsMap[QUOTA_ACCOUNTS_KEY];

const bindings = (agentId?: string | null) => (s: Store) =>
  agentId ? s.quotaBindingsMap[agentId] : undefined;

const readings = (accountId?: string | null) => (s: Store) =>
  accountId ? s.quotaReadingsMap[accountId] : undefined;

const history = (accountId?: string | null) => (s: Store) =>
  accountId ? s.quotaHistoryMap[accountId] : undefined;

const panel = (sourceKey: string) => (s: Store) => s.quotaPanelMap[hashQuotaSourceKey(sourceKey)];

/** The server answered for the account list in `scope` during this session. */
const isAccountsConfirmed = (scope: string) => (s: Store) =>
  !!s.quotaConfirmed[quotaConfirmedKey(scope, 'accounts', QUOTA_ACCOUNTS_KEY)];

/** The server answered for one agent's bindings in `scope` during this session. */
const isBindingsConfirmed = (scope: string, agentId?: string | null) => (s: Store) =>
  !!agentId && !!s.quotaConfirmed[quotaConfirmedKey(scope, 'bindings', agentId)];

/** The server answered for one account's calendar history in `scope` during this session. */
const isHistoryConfirmed = (scope: string, accountId?: string | null) => (s: Store) =>
  !!accountId && !!s.quotaConfirmed[quotaConfirmedKey(scope, 'history', accountId)];

export const agentQuotaSelectors = {
  accounts,
  bindings,
  history,
  isAccountsConfirmed,
  isBindingsConfirmed,
  isHistoryConfirmed,
  panel,
  readings,
};
