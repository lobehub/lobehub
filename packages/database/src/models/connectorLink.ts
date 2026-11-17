import type {
  ConnectorCredentials,
  ConnectorLinkProfile,
  ConnectorLinkRecord,
  ConnectorLinkStatus,
  ConnectorOAuthAccounts,
  ConnectorOAuthCredentials,
} from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import pMap from 'p-map';

import { ConnectorStatus, userConnectors, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { connectorAccessScope } from './connectorScope';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export type OAuthCredentials = ConnectorOAuthCredentials;

/** One OAuth account of a connector, decrypted. */
export interface DecryptedConnectorLink {
  authorizedByAvatar?: string | null;
  authorizedByName?: string | null;
  createdAt: Date;
  credentials: OAuthCredentials;
  /** Provider identity used to recognise the same account again; `null` when unknown. */
  externalAccountId: string | null;
  /** `lnk_…`, unique within its connector. */
  id: string;
  name: string;
  profile: ConnectorLinkProfile | null;
  status: ConnectorLinkStatus;
  tokenExpiresAt: Date | null;
  /** The connector the account belongs to. */
  userConnectorId: string;
  /** The member who authorized this account. */
  userId: string;
}
export type ConnectorLinkTarget = { kind: 'new' } | { kind: 'existing'; linkId: string };
export interface ConnectorLinkIdentity {
  externalAccountId?: string;
  profile?: ConnectorLinkProfile | null;
}
export interface ConnectorLinkAuthorization {
  authorizerId: string;
  credentials: OAuthCredentials;
  identity?: ConnectorLinkIdentity;
  target: ConnectorLinkTarget;
}
export interface ConnectorLinkAuthorizationResult {
  linkId: string;
  outcome: 'created' | 'reauthorized' | 'matchedExisting';
}

export class ConnectorLinkNotFoundError extends Error {}
export class ConnectorLinkNameTakenError extends Error {}

/**
 * Id of the account read from a single `oauth2` credential written before
 * accounts existed. Ids are unique within a connector only, so every such
 * connector can use the same one; it is kept once the accounts are rewritten.
 */
export const LEGACY_LINK_ID = 'lnk_default';

/** Rows decrypted at once; decryption is local but still awaited per row. */
const DECRYPT_CONCURRENCY = 10;
const MAX_LINK_NAME_LENGTH = 64;

export const deriveLinkDisplayName = (profile?: ConnectorLinkProfile | null): string | undefined =>
  profile?.email || profile?.username || profile?.name || undefined;

export const allocateLinkName = (existingNames: string[], preferred?: string): string => {
  const names = new Set(existingNames);
  const base = preferred?.trim().slice(0, MAX_LINK_NAME_LENGTH);
  if (base && !names.has(base)) return base;
  if (base) {
    for (let i = 2; ; i++) {
      const suffix = ` (${i})`;
      const name = base.slice(0, MAX_LINK_NAME_LENGTH - suffix.length) + suffix;
      if (!names.has(name)) return name;
    }
  }
  if (!names.has('Default')) return 'Default';
  for (let i = 2; ; i++) if (!names.has(`Account ${i}`)) return `Account ${i}`;
};

/** Whether a decrypted `credentials` value holds OAuth accounts. */
export const isConnectorOAuthAccounts = (value: unknown): value is ConnectorOAuthAccounts =>
  !!value &&
  typeof value === 'object' &&
  (value as { type?: unknown }).type === 'oauth2' &&
  Array.isArray((value as { accounts?: unknown }).accounts);

type StoredCredentials = ConnectorCredentials | ConnectorOAuthAccounts;

interface ConnectorRowSlice {
  createdAt: Date;
  credentials: string | null;
  id: string;
  status: string;
  userId: string;
}

const rowColumns = {
  createdAt: userConnectors.createdAt,
  credentials: userConnectors.credentials,
  id: userConnectors.id,
  status: userConnectors.status,
  userId: userConnectors.userId,
};

/** The accounts a connector's stored credentials hold; static credentials hold none. */
const toRecords = (
  row: ConnectorRowSlice,
  stored: StoredCredentials | null,
): ConnectorLinkRecord[] => {
  if (!stored) return [];
  if (isConnectorOAuthAccounts(stored)) return stored.accounts;
  if (stored.type !== 'oauth2') return [];
  const { idToken: _idToken, ...credentials } = stored;
  return [
    {
      createdAt: row.createdAt.getTime(),
      credentials,
      id: LEGACY_LINK_ID,
      name: 'Default',
      status: row.status === ConnectorStatus.error ? 'error' : 'connected',
      userId: row.userId,
    },
  ];
};

const toLink = (connectorId: string, record: ConnectorLinkRecord): DecryptedConnectorLink => ({
  createdAt: new Date(record.createdAt),
  credentials: { ...record.credentials },
  externalAccountId: record.externalAccountId ?? null,
  id: record.id,
  name: record.name,
  profile: record.profile ?? null,
  status: record.status,
  tokenExpiresAt: record.credentials.expiresAt ? new Date(record.credentials.expiresAt) : null,
  userConnectorId: connectorId,
  userId: record.userId,
});

/** Earliest known expiry among the accounts, kept in `token_expires_at`. */
const earliestExpiry = (records: ConnectorLinkRecord[]): Date | null => {
  const expiries = records
    .map((record) => record.credentials.expiresAt)
    .filter((expiresAt): expiresAt is number => typeof expiresAt === 'number');
  return expiries.length ? new Date(Math.min(...expiries)) : null;
};

const toStoredCredentials = (credentials: OAuthCredentials): ConnectorLinkRecord['credentials'] => {
  const { idToken: _idToken, ...persisted } = credentials;
  return persisted;
};

/**
 * The OAuth accounts of connectors. They are stored together, encrypted, in
 * the connector's own `credentials` column, so a connector holds either static
 * credentials or OAuth accounts, never both, and an account follows its
 * connector through every copy and delete.
 *
 * Every change locks the connector row, re-reads its accounts, changes the
 * one it targets and writes them back in one transaction: two accounts
 * refreshed at the same time must not overwrite each other's rotated tokens.
 * The same lock serialises these changes with `ConnectorModel.update`.
 */
export class ConnectorLinkModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    private gateKeeper?: GateKeeper,
  ) {}

  private scope = (db: LobeChatDatabase = this.db) =>
    connectorAccessScope(db, { userId: this.userId, workspaceId: this.workspaceId });

  /**
   * Decrypt a connector's stored credentials. `strict` throws on a value that
   * cannot be read instead of reading it as none, so a change never replaces
   * credentials it could not read.
   */
  private readStored = async (
    ciphertext: string | null,
    strict = false,
  ): Promise<StoredCredentials | null> => {
    if (!ciphertext) return null;
    try {
      const plain = this.gateKeeper
        ? (await this.gateKeeper.decrypt(ciphertext)).plaintext
        : ciphertext;
      return JSON.parse(plain) as StoredCredentials;
    } catch (error) {
      if (strict) throw error;
      return null;
    }
  };

  private encrypt = (records: ConnectorLinkRecord[]): Promise<string> => {
    const plain = JSON.stringify({
      accounts: records,
      type: 'oauth2',
    } satisfies ConnectorOAuthAccounts);
    return this.gateKeeper ? this.gateKeeper.encrypt(plain) : Promise.resolve(plain);
  };

  /**
   * Change the accounts of one connector under its row lock. `change` gets the
   * current accounts and returns the ones to store, or no `records` to leave
   * the row untouched; a connector left without any reads as disconnected.
   */
  private mutate = <T>(
    connectorId: string,
    change: (records: ConnectorLinkRecord[]) => { records?: ConnectorLinkRecord[]; result: T },
  ): Promise<T> =>
    this.db.transaction(async (tx) => {
      const [row] = await tx
        .select(rowColumns)
        .from(userConnectors)
        .where(and(eq(userConnectors.id, connectorId), this.scope(tx)))
        .for('update');
      if (!row) throw new ConnectorLinkNotFoundError('Connector not found');

      const { records, result } = change(
        toRecords(row, await this.readStored(row.credentials, true)),
      );
      if (!records) return result;
      await tx
        .update(userConnectors)
        .set({
          credentials: records.length ? await this.encrypt(records) : null,
          tokenExpiresAt: earliestExpiry(records),
          ...(!records.length && { status: ConnectorStatus.disconnected }),
          updatedAt: new Date(),
        })
        .where(eq(userConnectors.id, row.id));
      return result;
    });

  /** The accounts of the given connectors the caller may reach, oldest first per connector. */
  listByConnectorIds = async (ids: string[]): Promise<DecryptedConnectorLink[]> => {
    if (!ids.length) return [];
    const rows = await this.db
      .select(rowColumns)
      .from(userConnectors)
      .where(and(inArray(userConnectors.id, ids), this.scope()));
    const order = new Map(ids.map((id, index) => [id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const links = (
      await pMap(
        rows,
        async (row) =>
          toRecords(row, await this.readStored(row.credentials))
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((record) => toLink(row.id, record)),
        { concurrency: DECRYPT_CONCURRENCY },
      )
    ).flat();
    if (!links.length) return links;

    const authorizers = await this.db
      .select({
        avatar: users.avatar,
        id: users.id,
        name: sql<string | null>`COALESCE(${users.fullName}, ${users.username})`,
      })
      .from(users)
      .where(inArray(users.id, [...new Set(links.map((link) => link.userId))]));
    const byId = new Map(authorizers.map((user) => [user.id, user]));
    return links.map((link) => ({
      ...link,
      authorizedByAvatar: byId.get(link.userId)?.avatar ?? null,
      authorizedByName: byId.get(link.userId)?.name ?? null,
    }));
  };

  findById = async (connectorId: string, linkId: string): Promise<DecryptedConnectorLink | null> =>
    (await this.listByConnectorIds([connectorId])).find((link) => link.id === linkId) ?? null;

  /**
   * Store one completed authorization. The signed-in identity decides the
   * account: one already connected is refreshed even when another was targeted;
   * otherwise the targeted account, or a new one. A name taken from the
   * previous identity follows the new one; a name the user chose stays. OAuth
   * replaces any static credential the connector still carried.
   */
  applyAuthorization = (
    connectorId: string,
    params: ConnectorLinkAuthorization,
  ): Promise<ConnectorLinkAuthorizationResult> =>
    this.mutate<ConnectorLinkAuthorizationResult>(connectorId, (records) => {
      const { target } = params;
      const requested =
        target.kind === 'existing' ? records.find((r) => r.id === target.linkId) : undefined;
      if (target.kind === 'existing' && !requested)
        throw new ConnectorLinkNotFoundError('Connector account no longer exists');
      const matched = params.identity?.externalAccountId
        ? records.find((r) => r.externalAccountId === params.identity!.externalAccountId)
        : undefined;
      const current = matched ?? requested;
      const values = {
        credentials: toStoredCredentials(params.credentials),
        // The identity of the token stored now, never an older token's: one
        // kept from before would let a later authorization of that identity
        // match this account and overwrite the token it holds now.
        externalAccountId: params.identity?.externalAccountId ?? undefined,
        profile: params.identity?.profile ?? undefined,
        status: 'connected' as const,
        userId: params.authorizerId,
      };
      const displayName = deriveLinkDisplayName(params.identity?.profile);

      if (!current) {
        const created: ConnectorLinkRecord = {
          ...values,
          createdAt: Date.now(),
          id: idGenerator('connectorLinks'),
          name: allocateLinkName(
            records.map((r) => r.name),
            displayName,
          ),
        };
        return {
          records: [...records, created],
          result: { linkId: created.id, outcome: 'created' },
        };
      }

      const name =
        displayName && current.name === deriveLinkDisplayName(current.profile)
          ? allocateLinkName(
              records.filter((r) => r.id !== current.id).map((r) => r.name),
              displayName,
            )
          : current.name;
      return {
        records: records.map((r) => (r.id === current.id ? { ...r, ...values, name } : r)),
        result: {
          linkId: current.id,
          outcome: current.id === requested?.id ? 'reauthorized' : 'matchedExisting',
        },
      };
    });

  /** Store refreshed tokens of one account; a removed account is left removed. */
  updateCredentials = async (
    connectorId: string,
    linkId: string,
    credentials: OAuthCredentials,
    status: ConnectorLinkStatus = 'connected',
  ): Promise<void> => {
    await this.mutate(connectorId, (records) => ({
      records: records.some((r) => r.id === linkId)
        ? records.map((r) =>
            r.id === linkId
              ? {
                  ...r,
                  credentials: toStoredCredentials(credentials),
                  status,
                }
              : r,
          )
        : undefined,
      result: undefined,
    }));
  };

  updateStatus = async (
    connectorId: string,
    linkId: string,
    status: ConnectorLinkStatus,
  ): Promise<void> => {
    await this.mutate(connectorId, (records) => ({
      records: records.some((r) => r.id === linkId && r.status !== status)
        ? records.map((r) => (r.id === linkId ? { ...r, status } : r))
        : undefined,
      result: undefined,
    }));
  };

  rename = async (connectorId: string, linkId: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_LINK_NAME_LENGTH)
      throw new Error(`Account name must contain 1–${MAX_LINK_NAME_LENGTH} characters`);
    await this.mutate(connectorId, (records) => {
      if (!records.some((r) => r.id === linkId))
        throw new ConnectorLinkNotFoundError('Connector account not found');
      if (records.some((r) => r.id !== linkId && r.name === trimmed))
        throw new ConnectorLinkNameTakenError('An account with this name already exists');
      return {
        records: records.map((r) => (r.id === linkId ? { ...r, name: trimmed } : r)),
        result: undefined,
      };
    });
  };

  /**
   * Remove one account; reports how many its connector has left, `undefined`
   * when it has no such account.
   */
  remove = (connectorId: string, linkId: string): Promise<{ remaining: number } | undefined> =>
    this.mutate(connectorId, (records) => {
      if (!records.some((r) => r.id === linkId)) return { result: undefined };
      const remaining = records.filter((r) => r.id !== linkId);
      return { records: remaining, result: { remaining: remaining.length } };
    });
}
