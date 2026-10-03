import type {
  AgentAccountCapabilities,
  AgentAccountCredentialHint,
  AgentAccountKind,
  AgentAccountStatus,
} from '@lobechat/types';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import type { AgentAccountItem, NewAgentAccount } from '../schemas';
import { agentAccounts } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/**
 * The encryption contract the account model needs.
 *
 * Structural on purpose: `KeyVaultsGateKeeper` satisfies it, and tests pass a
 * plain stub without depending on the class's private key material.
 */
export interface AgentAccountGateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

/**
 * An account as every read path returns it.
 *
 * `credentials` is structurally absent — not merely empty — so a caller cannot
 * accidentally serialize the ciphertext, and `hasCredential` answers the only
 * question a read needs to ask about it.
 */
export type AgentAccountView = Omit<AgentAccountItem, 'credentials'> & {
  hasCredential: boolean;
};

/** The non-secret fields a caller may patch in place. */
export interface AgentAccountPatch {
  capabilities?: AgentAccountCapabilities;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  status?: AgentAccountItem['status'];
}

/** Strip the ciphertext from a freshly written row. */
const toView = (row: AgentAccountItem): AgentAccountView => {
  const { credentials, ...rest } = row;
  return { ...rest, hasCredential: credentials !== null };
};

/**
 * The read shape, selected explicitly.
 *
 * `credentials` is replaced by a SQL `is not null` so the ciphertext never even
 * leaves the database on a list/detail query — least privilege lives in the
 * query, not in a convention the next caller has to remember.
 */
const viewColumns = {
  accessedAt: agentAccounts.accessedAt,
  agentId: agentAccounts.agentId,
  capabilities: agentAccounts.capabilities,
  createdAt: agentAccounts.createdAt,
  credentialHint: agentAccounts.credentialHint,
  displayName: agentAccounts.displayName,
  hasCredential: sql<boolean>`${agentAccounts.credentials} is not null`.as('has_credential'),
  id: agentAccounts.id,
  identifier: agentAccounts.identifier,
  kind: agentAccounts.kind,
  metadata: agentAccounts.metadata,
  provider: agentAccounts.provider,
  revokedAt: agentAccounts.revokedAt,
  status: agentAccounts.status,
  updatedAt: agentAccounts.updatedAt,
  userId: agentAccounts.userId,
  workspaceId: agentAccounts.workspaceId,
};

/**
 * Statuses an inbound delivery may still reach.
 *
 * `provisioning` counts as live: both providers open an account synchronously,
 * so the handle is usable the moment the row exists. `revoked` and `suspended`
 * do not — releasing an identity has to stop its inbound, not merely its
 * outbound.
 */
const INBOUND_ROUTABLE_STATUSES: AgentAccountStatus[] = ['active', 'provisioning'];

/**
 * Agent accounts (mail / phone / wallet / service) and their credentials.
 *
 * Credential handling mirrors `AgentBotProviderModel` / `messengerAccountLinks`:
 * the secret is AES-GCM ciphertext written through an injected gatekeeper, and
 * only `getCredential` ever decrypts it.
 */
export class AgentAccountModel {
  private db: LobeChatDatabase;
  private gateKeeper?: AgentAccountGateKeeper;
  private userId: string;
  private workspaceId?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    gateKeeper?: AgentAccountGateKeeper,
    workspaceId?: string,
  ) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.gateKeeper = gateKeeper;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentAccounts);

  private encrypt = async (value: Record<string, string>): Promise<string> => {
    if (!this.gateKeeper) {
      throw new Error(
        'AgentAccountModel needs a gatekeeper to store credentials. Pass KeyVaultsGateKeeper (requires KEY_VAULTS_SECRET) when constructing it.',
      );
    }

    return this.gateKeeper.encrypt(JSON.stringify(value));
  };

  private decrypt = async (ciphertext: string): Promise<Record<string, string>> => {
    if (!this.gateKeeper) {
      throw new Error(
        'AgentAccountModel needs a gatekeeper to read credentials. Pass KeyVaultsGateKeeper (requires KEY_VAULTS_SECRET) when constructing it.',
      );
    }

    return JSON.parse((await this.gateKeeper.decrypt(ciphertext)).plaintext);
  };

  // --------------- Writes ---------------

  create = async (
    params: Omit<NewAgentAccount, 'credentials' | 'userId'> & {
      credential?: Record<string, string>;
      credentialHint?: AgentAccountCredentialHint;
    },
  ): Promise<AgentAccountView> => {
    const { credential, credentialHint, ...rest } = params;

    const [row] = await this.db
      .insert(agentAccounts)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            ...rest,
            credentials: credential ? await this.encrypt(credential) : null,
            credentialHint: credential
              ? { ...credentialHint, rotatedAt: new Date().toISOString() }
              : credentialHint,
          },
        ),
      )
      .returning();

    return toView(row);
  };

  /** Patch the non-secret fields. Credentials go through {@link setCredential}. */
  update = async (id: string, patch: AgentAccountPatch): Promise<string | undefined> => {
    const [row] = await this.db
      .update(agentAccounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(agentAccounts.id, id), this.ownership()))
      .returning({ id: agentAccounts.id });

    return row?.id;
  };

  /**
   * Install or rotate the credential. Write-only: nothing returns it, and the
   * hint's `rotatedAt` is stamped here so a reader can tell when it last changed.
   */
  setCredential = async (
    id: string,
    credential: Record<string, string>,
    hint?: Omit<AgentAccountCredentialHint, 'rotatedAt'>,
  ): Promise<string | undefined> => {
    const [row] = await this.db
      .update(agentAccounts)
      .set({
        credentialHint: { ...hint, rotatedAt: new Date().toISOString() },
        credentials: await this.encrypt(credential),
        updatedAt: new Date(),
      })
      .where(and(eq(agentAccounts.id, id), this.ownership()))
      .returning({ id: agentAccounts.id });

    return row?.id;
  };

  /**
   * Revoke an account. Purging the credential is the default: a revoked account
   * must not keep a usable secret behind it.
   */
  revoke = async (
    id: string,
    options: { purgeCredential?: boolean } = {},
  ): Promise<string | undefined> => {
    const purge = options.purgeCredential ?? true;

    const [row] = await this.db
      .update(agentAccounts)
      .set({
        ...(purge ? { credentialHint: null, credentials: null } : {}),
        revokedAt: new Date(),
        status: 'revoked',
        updatedAt: new Date(),
      })
      .where(and(eq(agentAccounts.id, id), this.ownership()))
      .returning({ id: agentAccounts.id });

    return row?.id;
  };

  // --------------- Reads ---------------

  query = async (params?: {
    agentId?: string;
    kind?: AgentAccountKind;
    provider?: string;
  }): Promise<AgentAccountView[]> => {
    const conditions = [this.ownership()];

    if (params?.agentId) conditions.push(eq(agentAccounts.agentId, params.agentId));
    if (params?.kind) conditions.push(eq(agentAccounts.kind, params.kind));
    if (params?.provider) conditions.push(eq(agentAccounts.provider, params.provider));

    return this.db
      .select(viewColumns)
      .from(agentAccounts)
      .where(and(...conditions))
      .orderBy(desc(agentAccounts.updatedAt));
  };

  findById = async (id: string): Promise<AgentAccountView | undefined> => {
    const [row] = await this.db
      .select(viewColumns)
      .from(agentAccounts)
      .where(and(eq(agentAccounts.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  /**
   * Decrypt the stored credential for internal use (signature verification,
   * login). The only read that yields a secret; scope-filtered, and callers
   * must never hand the result back to an API response or a model.
   */
  getCredential = async (id: string): Promise<Record<string, string> | null> => {
    const [row] = await this.db
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(and(eq(agentAccounts.id, id), this.ownership()))
      .limit(1);

    if (!row?.credentials) return null;

    return this.decrypt(row.credentials);
  };

  // --------------- Unscoped lookups (inbound routing) ---------------

  /**
   * Resolve an account from the routing key on an inbound webhook, before any
   * user is known. Authorization is the caller's job — this reaches rows
   * belonging to anyone, exactly like `AgentBotProviderModel.findByPlatformAndAppId`.
   *
   * A revoked row never routes. The unique indexes on the routing key are
   * partial (`status <> 'revoked'`), so a released handle can be bound again and
   * the key may then carry both the revoked row and its live replacement; this
   * filter mirrors that index so inbound traffic (and the credential used to
   * verify it) always resolves to the live account.
   *
   * `statuses` narrows the lookup further when the caller has a liveness rule to
   * apply; inbound routing passes {@link INBOUND_ROUTABLE_STATUSES}.
   */
  static findByRoutingKey = async (
    db: LobeChatDatabase,
    provider: string,
    identifier: string,
    statuses?: AgentAccountStatus[],
  ): Promise<AgentAccountView | undefined> => {
    const conditions = [
      eq(agentAccounts.provider, provider),
      eq(agentAccounts.identifier, identifier),
      ne(agentAccounts.status, 'revoked'),
    ];
    if (statuses) conditions.push(inArray(agentAccounts.status, statuses));

    const [row] = await db
      .select(viewColumns)
      .from(agentAccounts)
      .where(and(...conditions))
      .limit(1);

    return row;
  };

  /**
   * Whether any non-revoked account already routes on this handle. Mirrors the
   * partial unique index on `(provider, identifier)`: a revoked row keeps its
   * audit trail but no longer holds the handle, so it can be bound again.
   */
  static isRoutingKeyHeld = async (
    db: LobeChatDatabase,
    provider: string,
    identifier: string,
  ): Promise<boolean> => {
    const [row] = await db
      .select({ id: agentAccounts.id })
      .from(agentAccounts)
      .where(
        and(
          eq(agentAccounts.provider, provider),
          eq(agentAccounts.identifier, identifier),
          ne(agentAccounts.status, 'revoked'),
        ),
      )
      .limit(1);

    return !!row;
  };

  /**
   * Decrypt an account's credential while resolving an inbound webhook, so the
   * signature can be verified *before* the request is trusted. The trust model
   * is the same as the bot path: nothing else may call this.
   *
   * Only a live account is routable. A revoked number that keeps receiving is
   * the worst kind of release: the row says the identity is gone while the
   * carrier still delivers to it — and for Linq it is not even caught by the
   * credential check, because the signing secret comes from deployment config
   * rather than the account. Suspended accounts are excluded for the same
   * reason.
   */
  static findForInboundVerification = async (
    db: LobeChatDatabase,
    provider: string,
    identifier: string,
    gateKeeper?: AgentAccountGateKeeper,
  ): Promise<{ credential: Record<string, string> | null; view: AgentAccountView } | undefined> => {
    const view = await AgentAccountModel.findByRoutingKey(
      db,
      provider,
      identifier,
      INBOUND_ROUTABLE_STATUSES,
    );
    if (!view) return undefined;

    const [row] = await db
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(eq(agentAccounts.id, view.id))
      .limit(1);

    if (!row?.credentials) return { credential: null, view };
    if (!gateKeeper) return undefined;

    return {
      credential: JSON.parse((await gateKeeper.decrypt(row.credentials)).plaintext),
      view,
    };
  };
}
