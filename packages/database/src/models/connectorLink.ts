import type {
  ConnectorCredentials,
  ConnectorLinkProfile,
  ConnectorLinkRow,
  ConnectorLinkStatus,
  ConnectorOAuthCredentials,
} from '@lobechat/types';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import pMap from 'p-map';

import { userConnectorLinks, userConnectors, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { connectorAccessScope } from './connectorScope';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}
export type OAuthCredentials = ConnectorOAuthCredentials;
export interface DecryptedConnectorLink extends Omit<ConnectorLinkRow, 'credentials'> {
  authorizedByAvatar?: string | null;
  authorizedByName?: string | null;
  credentials: OAuthCredentials;
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
  tokenExpiresAt: Date | null;
}
export interface ConnectorLinkAuthorizationResult {
  linkId: string;
  outcome: 'created' | 'reauthorized' | 'matchedExisting';
}

/** Rows decrypted at once; decryption is local but still awaited per row. */
const DECRYPT_CONCURRENCY = 10;

export const deriveLinkDisplayName = (profile?: ConnectorLinkProfile | null): string | undefined =>
  profile?.email || profile?.username || profile?.name || undefined;

export const allocateLinkName = (existingNames: string[], preferred?: string): string => {
  const names = new Set(existingNames);
  const base = preferred?.trim().slice(0, 64);
  if (base && !names.has(base)) return base;
  if (base) {
    for (let i = 2; ; i++) {
      const suffix = ` (${i})`;
      const name = base.slice(0, 64 - suffix.length) + suffix;
      if (!names.has(name)) return name;
    }
  }
  if (!names.has('Default')) return 'Default';
  for (let i = 2; ; i++) if (!names.has(`Account ${i}`)) return `Account ${i}`;
};

/**
 * The OAuth accounts of connectors. Every method touches `user_connector_links`
 * only; flows that also change the connector row live in
 * `ConnectorAccountRepo`, which runs them in one transaction.
 */
export class ConnectorLinkModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    private gateKeeper?: GateKeeper,
  ) {}

  private scope = () =>
    connectorAccessScope(this.db, { userId: this.userId, workspaceId: this.workspaceId });
  private parentIds = () =>
    this.db.select({ id: userConnectors.id }).from(userConnectors).where(this.scope());
  private linkScope = () => inArray(userConnectorLinks.userConnectorId, this.parentIds());
  /** Links of one connector the caller may reach; empty for a connector out of scope. */
  private ofConnector = (connectorId: string) =>
    and(eq(userConnectorLinks.userConnectorId, connectorId), this.linkScope());
  private decrypt = async (row: ConnectorLinkRow): Promise<DecryptedConnectorLink> => {
    const plain = this.gateKeeper
      ? (await this.gateKeeper.decrypt(row.credentials)).plaintext
      : row.credentials;
    const credentials = JSON.parse(plain) as ConnectorCredentials;
    if (credentials.type !== 'oauth2') throw new Error('Invalid connector link credentials');
    return { ...row, credentials };
  };
  private encrypt = (credentials: OAuthCredentials) => {
    // id_token is transient identity input and is never stored on a link.
    const { idToken: _idToken, ...persisted } = credentials;
    const plain = JSON.stringify(persisted);
    return this.gateKeeper ? this.gateKeeper.encrypt(plain) : Promise.resolve(plain);
  };
  /** An insert has no predicate to scope it, so the connector is checked first. */
  private assertConnectorInScope = async (connectorId: string) => {
    const [parent] = await this.db
      .select({ id: userConnectors.id })
      .from(userConnectors)
      .where(and(eq(userConnectors.id, connectorId), this.scope()))
      .limit(1);
    if (!parent) throw new Error('Connector not found');
  };
  private orderedRows = (connectorId: string) =>
    this.db
      .select()
      .from(userConnectorLinks)
      .where(this.ofConnector(connectorId))
      .orderBy(asc(userConnectorLinks.createdAt), asc(userConnectorLinks.id));

  listByConnectorIds = async (ids: string[]): Promise<DecryptedConnectorLink[]> => {
    if (!ids.length) return [];
    const rows = await this.db
      .select({
        link: userConnectorLinks,
        authorizedByName: sql<string | null>`COALESCE(${users.fullName}, ${users.username})`,
        authorizedByAvatar: users.avatar,
      })
      .from(userConnectorLinks)
      .leftJoin(users, eq(users.id, userConnectorLinks.userId))
      .where(and(this.linkScope(), inArray(userConnectorLinks.userConnectorId, ids)))
      .orderBy(asc(userConnectorLinks.createdAt), asc(userConnectorLinks.id));
    return pMap(
      rows,
      async ({ link, ...attribution }) => ({ ...(await this.decrypt(link)), ...attribution }),
      { concurrency: DECRYPT_CONCURRENCY },
    );
  };

  findById = async (id: string): Promise<DecryptedConnectorLink | null> => {
    const [row] = await this.db
      .select()
      .from(userConnectorLinks)
      .where(and(eq(userConnectorLinks.id, id), this.linkScope()));
    return row ? this.decrypt(row) : null;
  };

  /**
   * Take over the credentials of a connector's legacy single slot: they replace
   * the earliest account, or become `Default` when there is none. An old
   * instance still writes that slot, so its write must land on the same account
   * rather than add one.
   */
  adoptCredentials = async (
    connectorId: string,
    params: {
      authorizerId: string;
      credentials: OAuthCredentials;
      status: ConnectorLinkStatus;
      tokenExpiresAt: Date | null;
    },
  ): Promise<void> => {
    await this.assertConnectorInScope(connectorId);
    const [earliest] = await this.orderedRows(connectorId);
    const values = {
      credentials: await this.encrypt(params.credentials),
      status: params.status,
      tokenExpiresAt: params.tokenExpiresAt,
    };
    if (earliest) {
      await this.db
        .update(userConnectorLinks)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(userConnectorLinks.id, earliest.id), this.linkScope()));
      return;
    }
    await this.db.insert(userConnectorLinks).values({
      ...values,
      name: 'Default',
      userConnectorId: connectorId,
      userId: params.authorizerId,
    });
  };

  /**
   * Store one completed authorization. The signed-in identity decides the
   * account: one already connected is refreshed even when another was targeted;
   * otherwise the targeted account, or a new one. A name taken from the
   * previous identity follows the new one; a name the user chose stays.
   */
  applyAuthorization = async (
    connectorId: string,
    params: ConnectorLinkAuthorization,
  ): Promise<ConnectorLinkAuthorizationResult> => {
    await this.assertConnectorInScope(connectorId);
    const rows = await this.orderedRows(connectorId);
    const { target } = params;
    const requested =
      target.kind === 'existing' ? rows.find((r) => r.id === target.linkId) : undefined;
    if (target.kind === 'existing' && !requested)
      throw new Error('Connector account no longer exists');
    const matched = params.identity?.externalAccountId
      ? rows.find((r) => r.externalAccountId === params.identity!.externalAccountId)
      : undefined;
    const current = matched ?? requested;
    const values = {
      credentials: await this.encrypt(params.credentials),
      externalAccountId: params.identity?.externalAccountId ?? current?.externalAccountId ?? null,
      profile: params.identity?.profile ?? current?.profile ?? null,
      status: 'connected' as const,
      tokenExpiresAt: params.tokenExpiresAt,
      userId: params.authorizerId,
      updatedAt: new Date(),
    };
    const displayName = deriveLinkDisplayName(params.identity?.profile);
    if (!current) {
      const [created] = await this.db
        .insert(userConnectorLinks)
        .values({
          ...values,
          userConnectorId: connectorId,
          name: allocateLinkName(
            rows.map((r) => r.name),
            displayName,
          ),
        })
        .returning();
      return { linkId: created.id, outcome: 'created' };
    }
    const name =
      displayName && current.name === deriveLinkDisplayName(current.profile)
        ? allocateLinkName(
            rows.filter((row) => row.id !== current.id).map((row) => row.name),
            displayName,
          )
        : current.name;
    await this.db
      .update(userConnectorLinks)
      .set({ ...values, name })
      .where(and(eq(userConnectorLinks.id, current.id), this.linkScope()));
    return {
      linkId: current.id,
      outcome: current.id === requested?.id ? 'reauthorized' : 'matchedExisting',
    };
  };

  updateCredentials = async (
    id: string,
    credentials: OAuthCredentials,
    tokenExpiresAt: Date | null,
  ) => {
    await this.db
      .update(userConnectorLinks)
      .set({
        credentials: await this.encrypt(credentials),
        tokenExpiresAt,
        status: 'connected',
        updatedAt: new Date(),
      })
      .where(and(eq(userConnectorLinks.id, id), this.linkScope()));
  };
  updateStatus = async (id: string, status: ConnectorLinkStatus) => {
    await this.db
      .update(userConnectorLinks)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(userConnectorLinks.id, id), this.linkScope()));
  };
  rename = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 64)
      throw new Error('Account name must contain 1–64 characters');
    await this.db
      .update(userConnectorLinks)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(and(eq(userConnectorLinks.id, id), this.linkScope()));
  };

  /** Remove one account; reports how many its connector has left. */
  remove = async (id: string): Promise<{ connectorId: string; remaining: number } | undefined> => {
    const [deleted] = await this.db
      .delete(userConnectorLinks)
      .where(and(eq(userConnectorLinks.id, id), this.linkScope()))
      .returning({ connectorId: userConnectorLinks.userConnectorId });
    if (!deleted) return;
    const [left] = await this.db
      .select({ remaining: count() })
      .from(userConnectorLinks)
      .where(this.ofConnector(deleted.connectorId));
    return { connectorId: deleted.connectorId, remaining: Number(left?.remaining ?? 0) };
  };
}
