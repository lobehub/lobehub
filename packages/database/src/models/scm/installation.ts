import type {
  ScmInstallationAccountType,
  ScmInstallationMetadata,
  ScmInstallationRepository,
  ScmProvider,
  ScmRepositorySelection,
} from '@lobechat/types';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';

import type { ScmInstallationItem } from '../../schemas';
import { scmInstallations } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** Provider facts about an installation, as normalized from the provider API or webhook. */
export interface ScmInstallationSnapshot {
  accountExternalId: string;
  accountLogin: string;
  accountType: ScmInstallationAccountType;
  installationId: string;
  metadata?: ScmInstallationMetadata;
  provider: ScmProvider;
  repositories?: ScmInstallationRepository[];
  repositorySelection: ScmRepositorySelection;
  suspendedAt?: Date | null;
}

export interface BindScmInstallationParams extends ScmInstallationSnapshot {
  installedByExternalLogin?: string | null;
  installedByExternalUserId?: string | null;
  userId: string;
  workspaceId?: string | null;
}

/**
 * CRUD for `scm_installations`. Callers are server-side (webhook ingest, the
 * install callback), so the model exposes static methods taking the db; the
 * row's `user_id` / `workspace_id` is the scope the installation binds to,
 * not the caller's identity.
 */
export class ScmInstallationModel {
  static findByProviderInstallationId = async (
    db: LobeChatDatabase,
    provider: ScmProvider,
    installationId: string,
  ): Promise<ScmInstallationItem | null> => {
    const [row] = await db
      .select()
      .from(scmInstallations)
      .where(
        and(
          eq(scmInstallations.provider, provider),
          eq(scmInstallations.installationId, installationId),
        ),
      )
      .limit(1);

    return row ?? null;
  };

  static findById = async (
    db: LobeChatDatabase,
    id: string,
  ): Promise<ScmInstallationItem | null> => {
    const [row] = await db.select().from(scmInstallations).where(eq(scmInstallations.id, id));
    return row ?? null;
  };

  /** Active installations visible to a scope: the workspace's, or the user's personal ones. */
  static listByScope = async (
    db: LobeChatDatabase,
    scope: { userId: string; workspaceId?: string | null },
  ): Promise<ScmInstallationItem[]> => {
    const scopeCondition = scope.workspaceId
      ? eq(scmInstallations.workspaceId, scope.workspaceId)
      : and(eq(scmInstallations.userId, scope.userId), isNull(scmInstallations.workspaceId));

    return db
      .select()
      .from(scmInstallations)
      .where(and(scopeCondition, isNull(scmInstallations.revokedAt)))
      .orderBy(desc(scmInstallations.createdAt));
  };

  /**
   * Create or refresh the row for an installation the user just connected.
   * Re-binding an existing installation keeps its id (change requests point
   * at it) but moves it to the new scope and clears any revocation — a user
   * who uninstalls and reinstalls gets the same GitHub installation id back.
   */
  static bind = async (
    db: LobeChatDatabase,
    params: BindScmInstallationParams,
  ): Promise<ScmInstallationItem> => {
    const values = {
      accountExternalId: params.accountExternalId,
      accountLogin: params.accountLogin,
      accountType: params.accountType,
      installationId: params.installationId,
      installedByExternalLogin: params.installedByExternalLogin ?? null,
      installedByExternalUserId: params.installedByExternalUserId ?? null,
      metadata: params.metadata ?? {},
      provider: params.provider,
      repositories: params.repositories ?? [],
      repositorySelection: params.repositorySelection,
      revokedAt: null,
      suspendedAt: params.suspendedAt ?? null,
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
    };

    const [row] = await db
      .insert(scmInstallations)
      .values(values)
      .onConflictDoUpdate({
        set: { ...values, updatedAt: new Date() },
        target: [scmInstallations.provider, scmInstallations.installationId],
      })
      .returning();

    // A provider account holds one installation of the app at a time, so any
    // other live row for the same account is a stale one (uninstalled and
    // reinstalled under a new id, or a missed `installation.deleted`): retire
    // it rather than list the account twice.
    await db
      .update(scmInstallations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(scmInstallations.provider, params.provider),
          eq(scmInstallations.accountExternalId, params.accountExternalId),
          ne(scmInstallations.id, row.id),
          isNull(scmInstallations.revokedAt),
        ),
      );

    return row;
  };

  /** Refresh provider facts on an existing row without touching its scope binding. */
  static refreshSnapshot = async (
    db: LobeChatDatabase,
    id: string,
    snapshot: Partial<Omit<ScmInstallationSnapshot, 'installationId' | 'provider'>>,
  ): Promise<void> => {
    await db
      .update(scmInstallations)
      .set({ ...snapshot, updatedAt: new Date() })
      .where(eq(scmInstallations.id, id));
  };

  static setRepositories = async (
    db: LobeChatDatabase,
    id: string,
    repositories: ScmInstallationRepository[],
  ): Promise<void> => {
    await db
      .update(scmInstallations)
      .set({ repositories, updatedAt: new Date() })
      .where(eq(scmInstallations.id, id));
  };

  static setSuspended = async (
    db: LobeChatDatabase,
    id: string,
    suspended: boolean,
  ): Promise<void> => {
    await db
      .update(scmInstallations)
      .set({ suspendedAt: suspended ? new Date() : null, updatedAt: new Date() })
      .where(eq(scmInstallations.id, id));
  };

  static markRevoked = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(scmInstallations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(scmInstallations.id, id));
  };
}
