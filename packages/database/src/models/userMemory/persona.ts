import { and, desc, eq } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import type {
  NewUserPersonaDocument,
  NewUserPersonaDocumentHistoriesItem,
  UserPersonaDocument,
  UserPersonaDocumentHistoriesItem,
} from '../../schemas';
import { userPersonaDocumentHistories, userPersonaDocuments } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export interface UpsertUserPersonaParams {
  capturedAt?: Date;
  diffPersona?: string | null;
  diffTagline?: string | null;
  editedBy?: 'user' | 'agent' | 'agent_tool';
  memoryIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  persona: string;
  profile?: string | null;
  reasoning?: string | null;
  snapshot?: string | null;
  sourceIds?: string[] | null;
  tagline?: string | null;
}

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
    return this.db.transaction(async (tx) => {
      const existing = await tx.query.userPersonaDocuments.findFirst({
        where: and(
          eq(userPersonaDocuments.userId, this.userId),
          eq(userPersonaDocuments.profile, params.profile ?? 'default'),
        ),
      });
      const nextVersion = (existing?.version ?? 0) + 1;
      const nextMemoryIds = params.memoryIds ?? existing?.memoryIds ?? undefined;
      const nextMetadata = params.metadata ?? existing?.metadata ?? undefined;
      const nextProfile = params.profile ?? 'default';
      const nextSourceIds = params.sourceIds ?? existing?.sourceIds ?? undefined;
      const nextTagline = params.tagline ?? existing?.tagline ?? undefined;

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
          .where(
            and(
              eq(userPersonaDocuments.id, existing.id),
              eq(userPersonaDocuments.userId, this.userId),
            ),
          )
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
          .values({ ...baseDocument, userId: this.userId })
          .returning();
      }

      let diff: UserPersonaDocumentHistoriesItem | undefined;
      const hasDiff =
        params.diffPersona ||
        params.diffTagline ||
        params.snapshot ||
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
            metadata: params.metadata ?? undefined,
            nextVersion: document.version,
            personaId: document.id,
            previousVersion: existing?.version,
            profile: document.profile,
            reasoning: params.reasoning ?? undefined,
            snapshot: params.snapshot ?? params.persona,
            snapshotPersona: document.persona,
            snapshotTagline: document.tagline,
            sourceIds: params.sourceIds ?? undefined,
            userId: this.userId,
          })
          .returning();
      }

      return { diff, document };
    });
  };
}
