import type { ConnectorLinkProfile, ConnectorLinkStatus } from '@lobechat/types';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { ConnectorCredentials, UserConnectorLinkItem } from '../schemas';
import { userConnectorLinks, userConnectors, users } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import type { DecryptedConnector } from './connector';
import { connectorAccessScope } from './connectorScope';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}
export type OAuthCredentials = Extract<ConnectorCredentials, { type: 'oauth2' }>;
export interface DecryptedConnectorLink extends Omit<UserConnectorLinkItem, 'credentials'> {
  authorizedByAvatar?: string | null;
  authorizedByName?: string | null;
  credentials: OAuthCredentials;
}
export type ConnectorLinkTarget = { kind: 'new' } | { kind: 'existing'; linkId: string };
export interface ConnectorLinkIdentity {
  externalAccountId?: string;
  profile?: ConnectorLinkProfile | null;
}

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
  private decrypt = async (row: UserConnectorLinkItem): Promise<DecryptedConnectorLink> => {
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
  private lockParent = async (tx: Transaction, id: string) => {
    const [parent] = await tx
      .select()
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), this.scope()))
      .for('update');
    if (!parent) throw new Error('Connector not found');
    return parent;
  };

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
    return Promise.all(
      rows.map(async ({ link, ...attribution }) => ({
        ...(await this.decrypt(link)),
        ...attribution,
      })),
    );
  };

  findById = async (id: string): Promise<DecryptedConnectorLink | null> => {
    const [row] = await this.db
      .select()
      .from(userConnectorLinks)
      .where(and(eq(userConnectorLinks.id, id), this.linkScope()));
    return row ? this.decrypt(row) : null;
  };

  adoptLegacyCredentials = async (connector: DecryptedConnector): Promise<void> => {
    if (connector.credentials?.type !== 'oauth2') return;
    await this.db.transaction(async (tx) => {
      const parent = await this.lockParent(tx, connector.id);
      if (!parent.credentials) return;
      const plain = this.gateKeeper
        ? (await this.gateKeeper.decrypt(parent.credentials)).plaintext
        : parent.credentials;
      const credentials = JSON.parse(plain) as ConnectorCredentials;
      if (credentials.type !== 'oauth2') return;
      const existing = await tx
        .select()
        .from(userConnectorLinks)
        .where(eq(userConnectorLinks.userConnectorId, connector.id))
        .orderBy(asc(userConnectorLinks.createdAt), asc(userConnectorLinks.id));
      const values = {
        credentials: await this.encrypt(credentials),
        status: parent.status === 'error' ? ('error' as const) : ('connected' as const),
        tokenExpiresAt: parent.tokenExpiresAt,
      };
      if (existing[0]) {
        // Old instances still overwrite the parent's single credential slot.
        // Adopt that write into the same earliest account instead of inventing one.
        await tx
          .update(userConnectorLinks)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(userConnectorLinks.id, existing[0].id));
      } else {
        await tx.insert(userConnectorLinks).values({
          ...values,
          name: 'Default',
          userConnectorId: parent.id,
          userId: parent.userId,
        });
      }
      await tx
        .update(userConnectors)
        .set({ credentials: null, tokenExpiresAt: null })
        .where(eq(userConnectors.id, connector.id));
    });
  };

  saveAuthorization = async (
    connectorId: string,
    params: {
      target: ConnectorLinkTarget;
      identity?: ConnectorLinkIdentity;
      credentials: OAuthCredentials;
      tokenExpiresAt: Date | null;
      authorizerId: string;
    },
  ): Promise<{ linkId: string; outcome: 'created' | 'reauthorized' | 'matchedExisting' }> =>
    this.db.transaction(async (tx) => {
      await this.lockParent(tx, connectorId);
      const rows = await tx
        .select()
        .from(userConnectorLinks)
        .where(eq(userConnectorLinks.userConnectorId, connectorId));
      const target = params.target;
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
      let linkId: string;
      if (current) {
        const displayName = deriveLinkDisplayName(params.identity?.profile);
        const name =
          displayName && current.name === deriveLinkDisplayName(current.profile)
            ? allocateLinkName(
                rows.filter((row) => row.id !== current.id).map((row) => row.name),
                displayName,
              )
            : current.name;
        await tx
          .update(userConnectorLinks)
          .set({ ...values, name })
          .where(eq(userConnectorLinks.id, current.id));
        linkId = current.id;
      } else {
        const [created] = await tx
          .insert(userConnectorLinks)
          .values({
            ...values,
            userConnectorId: connectorId,
            name: allocateLinkName(
              rows.map((r) => r.name),
              deriveLinkDisplayName(params.identity?.profile),
            ),
          })
          .returning();
        linkId = created.id;
      }
      await tx
        .update(userConnectors)
        .set({ credentials: null, tokenExpiresAt: null })
        .where(eq(userConnectors.id, connectorId));
      return {
        linkId,
        outcome: current
          ? current.id === requested?.id
            ? 'reauthorized'
            : 'matchedExisting'
          : 'created',
      };
    });

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
  delete = async (id: string) =>
    this.db.transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(userConnectorLinks)
        .where(and(eq(userConnectorLinks.id, id), this.linkScope()));
      if (!link) return;
      await this.lockParent(tx, link.userConnectorId);
      const deleted = await tx
        .delete(userConnectorLinks)
        .where(eq(userConnectorLinks.id, id))
        .returning({ id: userConnectorLinks.id });
      if (!deleted.length) return;
      const remaining = await tx
        .select({ id: userConnectorLinks.id })
        .from(userConnectorLinks)
        .where(eq(userConnectorLinks.userConnectorId, link.userConnectorId))
        .limit(1);
      if (!remaining.length)
        await tx
          .update(userConnectors)
          .set({ status: 'disconnected' })
          .where(eq(userConnectors.id, link.userConnectorId));
    });
}
