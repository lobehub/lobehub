import { toRecord } from '@lobechat/utils/object';

import { ConnectorDataError } from '../errors';
import { withConnectorRetry } from '../retry';
import { extractGmailEmail } from './normalize';
import type { GmailAccount } from './types';

const MAX_ACCOUNT_ID_LENGTH = 512;
const MAX_ACCOUNT_PAGES = 3;
const MAX_ACCOUNTS_PER_PAGE = 100;
const MAX_SCOPE_COUNT = 100;
const MAX_SCOPE_LENGTH = 256;

export interface GmailConnectedAccountListInput {
  cursor?: string;
  limit: number;
  toolkitSlugs: string[];
  userIds: string[];
}

export interface GmailComposioConnectedAccounts {
  get: (connectedAccountId: string) => Promise<unknown>;
  list: (input: GmailConnectedAccountListInput) => Promise<unknown>;
}

const readString = (
  record: Record<PropertyKey, unknown> | undefined,
  key: PropertyKey,
  limit: number,
) => {
  const value = record?.[key];
  return typeof value === 'string' ? value.slice(0, limit) : undefined;
};

const readScopes = (value: unknown) => {
  const values = Array.isArray(value)
    ? value.slice(0, MAX_SCOPE_COUNT)
    : typeof value === 'string'
      ? value.slice(0, 8000).split(/[\s,]+/)
      : [];
  return [
    ...new Set(
      values
        .filter((scope): scope is string => typeof scope === 'string')
        .map((scope) => scope.slice(0, MAX_SCOPE_LENGTH).trim())
        .filter(Boolean),
    ),
  ].sort();
};

const parseAccount = (value: unknown): GmailAccount | undefined => {
  const account = toRecord(value);
  if (!account) return undefined;
  const data = toRecord(account.data);
  const metadata = toRecord(account.metadata);
  const state = toRecord(account.state);
  const stateValue = toRecord(state?.val);
  const toolkit = toRecord(account.toolkit);
  const status = readString(account, 'status', 32) ?? readString(stateValue, 'status', 32);
  const toolkitSlug = readString(toolkit, 'slug', 32);
  if (
    account.isDisabled === true ||
    status?.toUpperCase() !== 'ACTIVE' ||
    toolkitSlug?.toLowerCase() !== 'gmail'
  ) {
    return undefined;
  }
  const id = readString(account, 'id', MAX_ACCOUNT_ID_LENGTH);
  if (!id) return undefined;
  const authScheme = readString(state, 'authScheme', 32)?.toUpperCase();
  const stateScope = authScheme === 'OAUTH2' ? stateValue?.scope : undefined;
  const stateEmail = authScheme === 'OAUTH2' ? stateValue?.email : undefined;
  const scopeValue = account.scopes ?? data?.scopes ?? account.scope ?? data?.scope ?? stateScope;

  return {
    email: extractGmailEmail(account.email ?? data?.email ?? metadata?.email ?? stateEmail),
    externalAccountId: id,
    scopes: readScopes(scopeValue),
  };
};

export interface LoadGmailAccountOptions {
  connectedAccountId: string;
  connectedAccounts: GmailComposioConnectedAccounts;
  userId: string;
}

export const loadGmailAccount = async ({
  connectedAccountId,
  connectedAccounts,
  userId,
}: LoadGmailAccountOptions): Promise<GmailAccount> => {
  try {
    let cursor: string | undefined;
    let ownedAccount: GmailAccount | undefined;

    for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
      const response = await withConnectorRetry(
        () =>
          connectedAccounts.list({
            ...(cursor ? { cursor } : {}),
            limit: MAX_ACCOUNTS_PER_PAGE,
            toolkitSlugs: ['gmail'],
            userIds: [userId],
          }),
        {
          code: 'gmail_account_unavailable',
          operation: 'getAccount',
          provider: 'gmail',
        },
      );
      const responseRecord = toRecord(response);
      const items = responseRecord?.items;
      if (!Array.isArray(items)) break;
      let match: unknown;
      const itemLimit = Math.min(items.length, MAX_ACCOUNTS_PER_PAGE);
      for (let index = 0; index < itemLimit; index += 1) {
        const item = items[index];
        if (readString(toRecord(item), 'id', MAX_ACCOUNT_ID_LENGTH) === connectedAccountId) {
          match = item;
          break;
        }
      }
      if (match) {
        ownedAccount = parseAccount(match);
        break;
      }
      const nextCursor = readString(responseRecord, 'nextCursor', MAX_ACCOUNT_ID_LENGTH);
      const totalPages =
        typeof responseRecord?.totalPages === 'number' ? responseRecord.totalPages : undefined;
      if (!nextCursor || (totalPages !== undefined && page + 1 >= totalPages)) {
        break;
      }
      cursor = nextCursor;
    }

    if (!ownedAccount) {
      throw new ConnectorDataError({
        code: 'gmail_account_unavailable',
        operation: 'getAccount',
        provider: 'gmail',
        retryable: false,
      });
    }
    if (ownedAccount.email && ownedAccount.scopes.length > 0) return ownedAccount;

    const detail = parseAccount(
      await withConnectorRetry(() => connectedAccounts.get(connectedAccountId), {
        code: 'gmail_account_unavailable',
        operation: 'getAccount',
        provider: 'gmail',
      }),
    );
    if (!detail || detail.externalAccountId !== connectedAccountId) {
      throw new ConnectorDataError({
        code: 'gmail_account_unavailable',
        operation: 'getAccount',
        provider: 'gmail',
        retryable: false,
      });
    }
    return {
      email: ownedAccount.email ?? detail.email,
      externalAccountId: ownedAccount.externalAccountId,
      scopes: ownedAccount.scopes.length > 0 ? ownedAccount.scopes : detail.scopes,
    };
  } catch (error) {
    if (error instanceof ConnectorDataError) throw error;
    throw new ConnectorDataError({
      code: 'gmail_account_unavailable',
      operation: 'getAccount',
      provider: 'gmail',
      retryable: false,
    });
  }
};
