import { isPlainRecord } from '@lobechat/utils/object';
import { and, desc, eq } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import type {
  NewUserPersonaDocument,
  NewUserPersonaDocumentHistoriesItem,
  UserPersonaDocument,
  UserPersonaDocumentHistoriesItem,
} from '../../schemas';
import { userPersonaDocumentHistories, userPersonaDocuments, users } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';

export interface UpsertUserPersonaParams {
  capturedAt?: Date;
  diffPersona?: string | null;
  diffTagline?: string | null;
  editedBy?: 'user' | 'agent' | 'agent_tool';
  memoryIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  metadataPatch?: Record<string, unknown>;
  persona: string;
  profile?: string | null;
  reasoning?: string | null;
  snapshot?: string | null;
  sourceIds?: string[] | null;
  tagline?: string | null;
}

export class UserPersonaVersionNotFoundError extends Error {
  constructor() {
    super('User persona version was not found');
    this.name = 'UserPersonaVersionNotFoundError';
  }
}

export class UserPersonaVersionSnapshotMissingError extends Error {
  constructor() {
    super('User persona version snapshot is unavailable');
    this.name = 'UserPersonaVersionSnapshotMissingError';
  }
}

export const lockUserPersonaOwner = async (tx: Transaction, userId: string): Promise<void> => {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!owner) throw new Error('User persona owner was not found');
};

export const getUserPersonaForUpdateInTransaction = async (
  tx: Transaction,
  userId: string,
  profile = 'default',
): Promise<UserPersonaDocument | undefined> => {
  const [document] = await tx
    .select()
    .from(userPersonaDocuments)
    .where(and(eq(userPersonaDocuments.userId, userId), eq(userPersonaDocuments.profile, profile)))
    .for('update');

  return document;
};

export const upsertUserPersonaInTransaction = async (
  tx: Transaction,
  userId: string,
  params: UpsertUserPersonaParams,
): Promise<{ diff?: UserPersonaDocumentHistoriesItem; document: UserPersonaDocument }> => {
  await lockUserPersonaOwner(tx, userId);

  const nextProfile = params.profile ?? 'default';
  const existing = await getUserPersonaForUpdateInTransaction(tx, userId, nextProfile);
  const nextVersion = (existing?.version ?? 0) + 1;
  const nextMemoryIds = params.memoryIds ?? existing?.memoryIds ?? undefined;
  const metadataBase = params.metadata ?? existing?.metadata ?? undefined;
  const nextMetadata =
    !params.metadataPatch || Object.keys(params.metadataPatch).length === 0
      ? metadataBase
      : { ...(isPlainRecord(metadataBase) ? metadataBase : {}), ...params.metadataPatch };
  const nextSourceIds = params.sourceIds ?? existing?.sourceIds ?? undefined;
  const nextTagline = params.tagline === undefined ? existing?.tagline : params.tagline;

  const baseDocument: Omit<NewUserPersonaDocument, 'id' | 'userId'> = {
    capturedAt: params.capturedAt,
    memoryIds: nextMemoryIds,
    metadata: nextMetadata,
    persona: params.persona,
    profile: nextProfile,
    sourceIds: nextSourceIds,
    tagline: nextTagline,
    version: nextVersion,
  };

  let document: UserPersonaDocument;

  if (existing) {
    const hasDocumentChanges =
      existing.persona !== params.persona ||
      existing.tagline !== (nextTagline ?? null) ||
      !isEqual(existing.memoryIds, nextMemoryIds ?? null) ||
      !isEqual(existing.sourceIds, nextSourceIds ?? null) ||
      !isEqual(existing.metadata, nextMetadata ?? null);

    if (!hasDocumentChanges) return { document: existing };

    const [updated] = await tx
      .update(userPersonaDocuments)
      .set({ ...baseDocument, updatedAt: new Date() })
      .where(and(eq(userPersonaDocuments.id, existing.id), eq(userPersonaDocuments.userId, userId)))
      .returning({
        accessedAt: userPersonaDocuments.accessedAt,
        capturedAt: userPersonaDocuments.capturedAt,
        createdAt: userPersonaDocuments.createdAt,
        id: userPersonaDocuments.id,
        updatedAt: userPersonaDocuments.updatedAt,
        version: userPersonaDocuments.version,
      });

    document = {
      ...existing,
      accessedAt: updated.accessedAt,
      capturedAt: updated.capturedAt,
      createdAt: updated.createdAt,
      id: updated.id,
      memoryIds: nextMemoryIds ?? null,
      metadata: nextMetadata ?? null,
      persona: params.persona,
      profile: nextProfile,
      sourceIds: nextSourceIds ?? null,
      tagline: nextTagline ?? null,
      updatedAt: updated.updatedAt,
      version: updated.version,
    };
  } else {
    [document] = await tx
      .insert(userPersonaDocuments)
      .values({ ...baseDocument, userId })
      .returning();
  }

  let diff: UserPersonaDocumentHistoriesItem | undefined;
  const hasDiff =
    params.diffPersona ||
    params.diffTagline ||
    params.snapshot != null ||
    params.reasoning ||
    (params.memoryIds && params.memoryIds.length > 0) ||
    (params.sourceIds && params.sourceIds.length > 0);

  if (hasDiff) {
    [diff] = await tx
      .insert(userPersonaDocumentHistories)
      .values({
        capturedAt: params.capturedAt,
        diffPersona: params.diffPersona ?? undefined,
        diffTagline: params.diffTagline ?? undefined,
        editedBy: params.editedBy ?? 'agent',
        memoryIds: params.memoryIds ?? undefined,
        metadata: nextMetadata,
        nextVersion: document.version,
        personaId: document.id,
        previousVersion: existing?.version,
        profile: document.profile,
        reasoning: params.reasoning ?? undefined,
        snapshot: params.snapshot ?? params.persona,
        snapshotPersona: document.persona,
        snapshotTagline: document.tagline,
        sourceIds: params.sourceIds ?? undefined,
        userId,
      })
      .returning();
  }

  return { diff, document };
};

export class UserPersonaModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getLatestPersonaDocument = async (profile = 'default') => {
    return this.db.query.userPersonaDocuments.findFirst({
      orderBy: [desc(userPersonaDocuments.version), desc(userPersonaDocuments.updatedAt)],
      where: and(
        eq(userPersonaDocuments.userId, this.userId),
        eq(userPersonaDocuments.profile, profile),
      ),
    });
  };

  // Alias for consistency with other models
  getLatestDocument = async (profile = 'default') => this.getLatestPersonaDocument(profile);

  listDiffs = async (limit = 50, profile = 'default') => {
    return this.db.query.userPersonaDocumentHistories.findMany({
      limit,
      orderBy: [desc(userPersonaDocumentHistories.createdAt)],
      where: and(
        eq(userPersonaDocumentHistories.userId, this.userId),
        eq(userPersonaDocumentHistories.profile, profile),
      ),
    });
  };

  listVersions = async (limit = 50) => {
    return this.db
      .select({
        createdAt: userPersonaDocumentHistories.createdAt,
        id: userPersonaDocumentHistories.id,
        nextVersion: userPersonaDocumentHistories.nextVersion,
        previousVersion: userPersonaDocumentHistories.previousVersion,
        snapshotPersona: userPersonaDocumentHistories.snapshotPersona,
        snapshotTagline: userPersonaDocumentHistories.snapshotTagline,
      })
      .from(userPersonaDocumentHistories)
      .where(
        and(
          eq(userPersonaDocumentHistories.userId, this.userId),
          eq(userPersonaDocumentHistories.profile, 'default'),
        ),
      )
      .orderBy(
        desc(userPersonaDocumentHistories.createdAt),
        desc(userPersonaDocumentHistories.nextVersion),
      )
      .limit(limit);
  };

  appendDiff = async (
    params: Omit<NewUserPersonaDocumentHistoriesItem, 'id' | 'userId'> & { personaId: string },
  ): Promise<UserPersonaDocumentHistoriesItem> => {
    const [result] = await this.db
      .insert(userPersonaDocumentHistories)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  deletePersona = async (profile = 'default'): Promise<void> => {
    const existing = await this.getLatestPersonaDocument(profile);
    if (!existing) return;

    await this.db
      .delete(userPersonaDocuments)
      .where(
        and(
          eq(userPersonaDocuments.userId, this.userId),
          eq(userPersonaDocuments.profile, profile),
        ),
      );
  };

  upsertPersona = async (
    params: UpsertUserPersonaParams,
  ): Promise<{ diff?: UserPersonaDocumentHistoriesItem; document: UserPersonaDocument }> => {
    return this.db.transaction((tx) => upsertUserPersonaInTransaction(tx, this.userId, params));
  };

  restoreVersion = async (historyId: string) => {
    return this.db.transaction(async (tx) => {
      const [history] = await tx
        .select({
          snapshotPersona: userPersonaDocumentHistories.snapshotPersona,
          snapshotTagline: userPersonaDocumentHistories.snapshotTagline,
        })
        .from(userPersonaDocumentHistories)
        .where(
          and(
            eq(userPersonaDocumentHistories.id, historyId),
            eq(userPersonaDocumentHistories.userId, this.userId),
            eq(userPersonaDocumentHistories.profile, 'default'),
          ),
        );
      if (!history) throw new UserPersonaVersionNotFoundError();
      if (history.snapshotPersona == null) throw new UserPersonaVersionSnapshotMissingError();

      return upsertUserPersonaInTransaction(tx, this.userId, {
        editedBy: 'user',
        persona: history.snapshotPersona,
        snapshot: history.snapshotPersona,
        tagline: history.snapshotTagline,
      });
    });
  };
}
