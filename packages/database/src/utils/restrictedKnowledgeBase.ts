import type { SQL, SQLWrapper } from 'drizzle-orm';
import { and, eq, exists, inArray, isNotNull, isNull, not, notInArray, or } from 'drizzle-orm';

import { knowledgeBaseFiles, knowledgeBases } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from './softDelete';

export interface RestrictedKnowledgeBaseFilter {
  /** Live restricted libraries. Any membership hides the resource. */
  liveKnowledgeBaseIds?: string[];
  /** Deleted restricted libraries. Membership hides only otherwise-unshared resources. */
  trashedKnowledgeBaseIds?: string[];
}

interface RestrictedKnowledgeBaseScope {
  userId: string;
  workspaceId: string;
}

const hasMembership = (db: LobeChatDatabase, fileId: SQLWrapper, knowledgeBaseIds: string[]) =>
  exists(
    db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(
        and(
          eq(knowledgeBaseFiles.fileId, fileId),
          inArray(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseIds),
        ),
      ),
  );

const hasBrowsableLiveMembership = (
  db: LobeChatDatabase,
  fileId: SQLWrapper,
  scope: RestrictedKnowledgeBaseScope,
  liveRestrictedIds: string[],
) =>
  exists(
    db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, knowledgeBaseFiles.knowledgeBaseId))
      .where(
        and(
          eq(knowledgeBaseFiles.fileId, fileId),
          eq(knowledgeBases.workspaceId, scope.workspaceId),
          notTrashed(knowledgeBases.isDeleted),
          liveRestrictedIds.length > 0
            ? notInArray(knowledgeBases.id, liveRestrictedIds)
            : undefined,
          or(
            isNull(knowledgeBases.visibility),
            eq(knowledgeBases.visibility, 'public'),
            eq(knowledgeBases.userId, scope.userId),
          ),
        ),
      ),
  );

/** Positive predicate: the correlated file is hidden by the caller-relative KB policy. */
export const fileInRestrictedKnowledgeBase = (
  db: LobeChatDatabase,
  fileId: SQLWrapper,
  scope: RestrictedKnowledgeBaseScope,
  filter: RestrictedKnowledgeBaseFilter,
): SQL | undefined => {
  const liveIds = filter.liveKnowledgeBaseIds ?? [];
  const trashedIds = filter.trashedKnowledgeBaseIds ?? [];
  if (liveIds.length === 0 && trashedIds.length === 0) return;

  const liveMembership = liveIds.length > 0 ? hasMembership(db, fileId, liveIds) : undefined;
  const trashedExclusiveMembership =
    trashedIds.length > 0
      ? and(
          hasMembership(db, fileId, trashedIds),
          not(hasBrowsableLiveMembership(db, fileId, scope, liveIds)),
        )
      : undefined;

  return or(liveMembership, trashedExclusiveMembership);
};

/** Positive predicate: the correlated document is hidden by the caller-relative KB policy. */
export const documentInRestrictedKnowledgeBase = (
  db: LobeChatDatabase,
  columns: { fileId: SQLWrapper; knowledgeBaseId: SQLWrapper },
  scope: RestrictedKnowledgeBaseScope,
  filter: RestrictedKnowledgeBaseFilter,
): SQL | undefined => {
  const liveIds = filter.liveKnowledgeBaseIds ?? [];
  const trashedIds = filter.trashedKnowledgeBaseIds ?? [];
  if (liveIds.length === 0 && trashedIds.length === 0) return;

  const liveFileMembership =
    liveIds.length > 0 ? hasMembership(db, columns.fileId, liveIds) : undefined;
  const liveDirectMembership =
    liveIds.length > 0
      ? and(isNotNull(columns.knowledgeBaseId), inArray(columns.knowledgeBaseId, liveIds))
      : undefined;
  const trashedMembership =
    trashedIds.length > 0
      ? or(
          and(isNotNull(columns.knowledgeBaseId), inArray(columns.knowledgeBaseId, trashedIds)),
          hasMembership(db, columns.fileId, trashedIds),
        )
      : undefined;
  const trashedExclusiveMembership = trashedMembership
    ? and(trashedMembership, not(hasBrowsableLiveMembership(db, columns.fileId, scope, liveIds)))
    : undefined;

  return or(liveDirectMembership, liveFileMembership, trashedExclusiveMembership);
};

export const excludeRestrictedFile = (
  db: LobeChatDatabase,
  fileId: SQLWrapper,
  scope: RestrictedKnowledgeBaseScope,
  filter: RestrictedKnowledgeBaseFilter,
): SQL | undefined => {
  const restricted = fileInRestrictedKnowledgeBase(db, fileId, scope, filter);
  return restricted ? not(restricted) : undefined;
};

export const excludeRestrictedDocument = (
  db: LobeChatDatabase,
  columns: { fileId: SQLWrapper; knowledgeBaseId: SQLWrapper },
  scope: RestrictedKnowledgeBaseScope,
  filter: RestrictedKnowledgeBaseFilter,
): SQL | undefined => {
  const restricted = documentInRestrictedKnowledgeBase(db, columns, scope, filter);
  return restricted ? not(restricted) : undefined;
};
