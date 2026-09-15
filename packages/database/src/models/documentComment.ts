import type { DocumentCommentJson } from '@lobechat/types';
import { and, asc, count, eq, getTableColumns, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import type { DocumentCommentItem } from '../schemas/documentComment';
import { documentCommentMentions, documentComments } from '../schemas/documentComment';
import { documents } from '../schemas/file';
import type { LobeChatDatabase } from '../type';

export const DOCUMENT_COMMENT_WORKSPACE_REQUIRED =
  'Document comments are workspace-scoped; a workspaceId is required';
export const DOCUMENT_COMMENT_DOCUMENT_NOT_FOUND = 'Document not found in current workspace';
export const DOCUMENT_COMMENT_PARENT_NOT_FOUND = 'Parent comment not found in the document';

const documentCommentCursorSelection = {
  ...getTableColumns(documentComments),
  cursorCreatedAt: sql<string>`${documentComments.createdAt}::text`.as('cursor_created_at'),
};

const encodeCursor = (createdAt: string, id: string): string => `${createdAt}|${id}`;

const decodeCursor = (cursor?: string): { createdAt: string; id: string } | null => {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf('|');
  if (separator <= 0) return null;
  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
};

export interface CreateDocumentCommentParams {
  clientId: string;
  content: string;
  documentId: string;
  editorData?: DocumentCommentJson;
  /** Validated active Workspace members parsed from editorData by the router. */
  mentionedUserIds?: string[];
  parentCommentId?: string;
}

export interface CreateDocumentCommentResult {
  /** Mention targets written by this create; empty for an idempotent retry. */
  addedMentionUserIds: string[];
  comment: DocumentCommentItem;
  /** Author of the document; receives activity for a new root comment. */
  documentAuthorUserId: string;
  /** true when the idempotency key already existed and no new activity should be emitted */
  isDuplicate: boolean;
  /**
   * Author of the directly targeted comment when creating a reply. Null when
   * the target is a tombstone so nobody is pinged about a deleted comment.
   */
  parentAuthorUserId?: string | null;
  /**
   * Everyone else already talking in the thread when creating a reply: the
   * root author plus authors of live replies, minus the actor and the direct
   * reply target (who receives the stronger `replied` ping instead).
   */
  threadParticipantUserIds: string[];
}

export interface UpdateDocumentCommentParams {
  content?: string;
  editorData?: DocumentCommentJson;
}

export interface UpdateDocumentCommentOptions {
  /** Replace the persisted mention set with these validated Workspace member ids. */
  mentionedUserIds?: string[];
}

export interface UpdateDocumentCommentResult {
  /** Newly added mention targets; only these should receive a notification. */
  addedMentionUserIds: string[];
  comment: DocumentCommentItem;
}

export interface ListDocumentCommentThreadsParams {
  cursor?: string;
  documentId: string;
  limit?: number;
}

export interface ListDocumentCommentRepliesParams {
  cursor?: string;
  limit?: number;
  rootCommentId: string;
}

export class DocumentCommentModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private requireWorkspaceId = (): string => {
    if (!this.workspaceId) throw new Error(DOCUMENT_COMMENT_WORKSPACE_REQUIRED);
    return this.workspaceId;
  };

  async create(params: CreateDocumentCommentParams): Promise<CreateDocumentCommentResult> {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      const [document] = await tx
        .select({ id: documents.id, userId: documents.userId, workspaceId: documents.workspaceId })
        .from(documents)
        .where(eq(documents.id, params.documentId))
        .limit(1)
        .for('update');

      if (!document || document.workspaceId !== workspaceId) {
        throw new Error(DOCUMENT_COMMENT_DOCUMENT_NOT_FOUND);
      }

      let parentCommentId: string | null = null;
      let parentAuthorUserId: string | null | undefined;
      let replyToCommentId: string | null = null;
      let threadParticipantUserIds: string[] = [];
      if (params.parentCommentId) {
        const [parent] = await tx
          .select({
            authorUserId: documentComments.authorUserId,
            deletedAt: documentComments.deletedAt,
            documentId: documentComments.documentId,
            id: documentComments.id,
            parentCommentId: documentComments.parentCommentId,
            workspaceId: documentComments.workspaceId,
          })
          .from(documentComments)
          .where(eq(documentComments.id, params.parentCommentId))
          .limit(1)
          .for('key share');

        if (
          !parent ||
          parent.documentId !== params.documentId ||
          parent.workspaceId !== workspaceId
        ) {
          throw new Error(DOCUMENT_COMMENT_PARENT_NOT_FOUND);
        }
        parentAuthorUserId = parent.deletedAt ? null : parent.authorUserId;
        parentCommentId = parent.parentCommentId ?? parent.id;
        replyToCommentId = parent.parentCommentId ? parent.id : null;

        const threadMembers = await tx
          .select({ authorUserId: documentComments.authorUserId })
          .from(documentComments)
          .where(
            and(
              or(
                eq(documentComments.id, parentCommentId),
                eq(documentComments.parentCommentId, parentCommentId),
              ),
              eq(documentComments.workspaceId, workspaceId),
              isNull(documentComments.deletedAt),
            ),
          )
          .groupBy(documentComments.authorUserId);
        threadParticipantUserIds = threadMembers
          .map(({ authorUserId }) => authorUserId)
          .filter(
            (userId): userId is string =>
              Boolean(userId) && userId !== this.userId && userId !== parentAuthorUserId,
          );
      }

      const [inserted] = await tx
        .insert(documentComments)
        .values({
          authorUserId: this.userId,
          clientId: params.clientId,
          content: params.content,
          documentId: params.documentId,
          editorData: params.editorData,
          parentCommentId,
          replyToCommentId,
          workspaceId,
        })
        .onConflictDoNothing({
          target: [
            documentComments.documentId,
            documentComments.authorUserId,
            documentComments.clientId,
          ],
        })
        .returning();

      if (inserted) {
        const mentionedUserIds = [...new Set(params.mentionedUserIds ?? [])];
        if (mentionedUserIds.length > 0) {
          await tx
            .insert(documentCommentMentions)
            .values(
              mentionedUserIds.map((mentionedUserId) => ({
                commentId: inserted.id,
                mentionedUserId,
                workspaceId,
              })),
            )
            .onConflictDoNothing();
        }

        return {
          addedMentionUserIds: mentionedUserIds,
          comment: inserted,
          documentAuthorUserId: document.userId,
          isDuplicate: false,
          parentAuthorUserId,
          threadParticipantUserIds,
        };
      }

      const [existing] = await tx
        .select()
        .from(documentComments)
        .where(
          and(
            eq(documentComments.documentId, params.documentId),
            eq(documentComments.workspaceId, workspaceId),
            eq(documentComments.authorUserId, this.userId),
            eq(documentComments.clientId, params.clientId),
          ),
        )
        .limit(1);
      if (!existing) throw new Error('Failed to create document comment');
      return {
        addedMentionUserIds: [],
        comment: existing,
        documentAuthorUserId: document.userId,
        isDuplicate: true,
        parentAuthorUserId,
        threadParticipantUserIds: [],
      };
    });
  }

  async update(
    id: string,
    params: UpdateDocumentCommentParams,
    options: UpdateDocumentCommentOptions = {},
  ): Promise<UpdateDocumentCommentResult | undefined> {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (tx) => {
      const [comment] = await tx
        .update(documentComments)
        .set({
          ...(params.content === undefined ? {} : { content: params.content }),
          ...(params.editorData === undefined ? {} : { editorData: params.editorData }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentComments.id, id),
            eq(documentComments.workspaceId, workspaceId),
            eq(documentComments.authorUserId, this.userId),
            isNull(documentComments.deletedAt),
          ),
        )
        .returning();
      if (!comment) return undefined;

      let addedMentionUserIds: string[] = [];
      if (options.mentionedUserIds) {
        const next = [...new Set(options.mentionedUserIds)];
        const existingRows = await tx
          .select({ mentionedUserId: documentCommentMentions.mentionedUserId })
          .from(documentCommentMentions)
          .where(eq(documentCommentMentions.commentId, id));
        const existing = new Set(existingRows.map(({ mentionedUserId }) => mentionedUserId));
        addedMentionUserIds = next.filter((userId) => !existing.has(userId));
        const removedMentionUserIds = [...existing].filter((userId) => !next.includes(userId));

        if (addedMentionUserIds.length > 0) {
          await tx
            .insert(documentCommentMentions)
            .values(
              addedMentionUserIds.map((mentionedUserId) => ({
                commentId: id,
                mentionedUserId,
                workspaceId,
              })),
            )
            .onConflictDoNothing();
        }
        if (removedMentionUserIds.length > 0) {
          await tx
            .delete(documentCommentMentions)
            .where(
              and(
                eq(documentCommentMentions.commentId, id),
                inArray(documentCommentMentions.mentionedUserId, removedMentionUserIds),
              ),
            );
        }
      }

      return { addedMentionUserIds, comment };
    });
  }

  async delete(id: string, options: { overrideAuthorScope?: boolean } = {}) {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      const conditions = [
        eq(documentComments.id, id),
        eq(documentComments.workspaceId, workspaceId),
      ];
      if (!options.overrideAuthorScope) {
        conditions.push(eq(documentComments.authorUserId, this.userId));
      }

      const [candidate] = await tx
        .select({ id: documentComments.id, parentCommentId: documentComments.parentCommentId })
        .from(documentComments)
        .where(and(...conditions))
        .limit(1);
      if (!candidate) return false;

      const rootId = candidate.parentCommentId ?? candidate.id;
      const [root] = await tx
        .select({ id: documentComments.id })
        .from(documentComments)
        .where(
          and(
            eq(documentComments.id, rootId),
            eq(documentComments.workspaceId, workspaceId),
            isNull(documentComments.parentCommentId),
          ),
        )
        .for('update');
      if (!root) return false;

      const [comment] = await tx
        .select({
          deletedAt: documentComments.deletedAt,
          id: documentComments.id,
          parentCommentId: documentComments.parentCommentId,
        })
        .from(documentComments)
        .where(and(...conditions))
        .limit(1);
      if (!comment || comment.deletedAt) return false;

      const [replyCount] = await tx
        .select({ total: count() })
        .from(documentComments)
        .where(eq(documentComments.parentCommentId, id));

      if ((replyCount?.total ?? 0) > 0) {
        await tx.delete(documentCommentMentions).where(eq(documentCommentMentions.commentId, id));
        await tx
          .update(documentComments)
          .set({ content: '', deletedAt: new Date(), editorData: null, updatedAt: new Date() })
          .where(eq(documentComments.id, id));
        return 'soft' as const;
      }

      await tx.delete(documentComments).where(eq(documentComments.id, id));

      if (comment.parentCommentId) {
        const [parent] = await tx
          .select({ deletedAt: documentComments.deletedAt, id: documentComments.id })
          .from(documentComments)
          .where(eq(documentComments.id, comment.parentCommentId))
          .limit(1);
        if (parent?.deletedAt) {
          const [siblings] = await tx
            .select({ total: count() })
            .from(documentComments)
            .where(eq(documentComments.parentCommentId, parent.id));
          if ((siblings?.total ?? 0) === 0) {
            await tx.delete(documentComments).where(eq(documentComments.id, parent.id));
          }
        }
      }

      return 'hard' as const;
    });
  }

  async findById(id: string) {
    const workspaceId = this.requireWorkspaceId();
    const [comment] = await this.db
      .select()
      .from(documentComments)
      .where(and(eq(documentComments.id, id), eq(documentComments.workspaceId, workspaceId)))
      .limit(1);
    return comment;
  }

  /** Live (non-tombstoned) replies under one root, for a single-thread lookup. */
  async countLiveReplies(rootCommentId: string) {
    const workspaceId = this.requireWorkspaceId();
    const [row] = await this.db
      .select({ total: count() })
      .from(documentComments)
      .where(
        and(
          eq(documentComments.workspaceId, workspaceId),
          eq(documentComments.parentCommentId, rootCommentId),
          isNull(documentComments.deletedAt),
        ),
      );
    return row?.total ?? 0;
  }

  async listThreads(params: ListDocumentCommentThreadsParams) {
    const workspaceId = this.requireWorkspaceId();
    const { cursor, documentId, limit = 20 } = params;
    const conditions = [
      eq(documentComments.documentId, documentId),
      eq(documentComments.workspaceId, workspaceId),
      isNull(documentComments.parentCommentId),
    ];
    const decodedCursor = decodeCursor(cursor);
    if (decodedCursor) {
      const createdAt = sql`${decodedCursor.createdAt}::timestamptz`;
      conditions.push(
        or(
          gt(documentComments.createdAt, createdAt),
          and(eq(documentComments.createdAt, createdAt), gt(documentComments.id, decodedCursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select(documentCommentCursorSelection)
      .from(documentComments)
      .where(and(...conditions))
      .orderBy(asc(documentComments.createdAt), asc(documentComments.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const roots = pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...root }) => root);
    const rootIds = roots.map(({ id }) => id);
    const replyCounts = rootIds.length
      ? await this.db
          .select({ parentCommentId: documentComments.parentCommentId, total: count() })
          .from(documentComments)
          .where(
            and(
              eq(documentComments.workspaceId, workspaceId),
              inArray(documentComments.parentCommentId, rootIds),
              isNull(documentComments.deletedAt),
            ),
          )
          .groupBy(documentComments.parentCommentId)
      : [];
    const countByRoot = new Map(
      replyCounts.flatMap(({ parentCommentId, total }) =>
        parentCommentId ? [[parentCommentId, total] as const] : [],
      ),
    );

    return {
      items: roots.map((root) => ({ replyCount: countByRoot.get(root.id) ?? 0, root })),
      nextCursor: hasMore
        ? encodeCursor(pageRows.at(-1)!.cursorCreatedAt, pageRows.at(-1)!.id)
        : null,
    };
  }

  async listReplies(params: ListDocumentCommentRepliesParams) {
    const workspaceId = this.requireWorkspaceId();
    const { cursor, limit = 50, rootCommentId } = params;
    const conditions = [
      eq(documentComments.parentCommentId, rootCommentId),
      eq(documentComments.workspaceId, workspaceId),
    ];
    const decodedCursor = decodeCursor(cursor);
    if (decodedCursor) {
      const createdAt = sql`${decodedCursor.createdAt}::timestamptz`;
      conditions.push(
        or(
          gt(documentComments.createdAt, createdAt),
          and(eq(documentComments.createdAt, createdAt), gt(documentComments.id, decodedCursor.id)),
        )!,
      );
    }

    const [rows, total] = await Promise.all([
      this.db
        .select(documentCommentCursorSelection)
        .from(documentComments)
        .where(and(...conditions))
        .orderBy(asc(documentComments.createdAt), asc(documentComments.id))
        .limit(limit + 1),
      decodedCursor
        ? Promise.resolve(undefined)
        : this.db
            .select({ total: count() })
            .from(documentComments)
            .where(
              and(
                eq(documentComments.parentCommentId, rootCommentId),
                eq(documentComments.workspaceId, workspaceId),
                isNull(documentComments.deletedAt),
              ),
            )
            .then(([row]) => row.total),
    ]);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...item }) => item),
      nextCursor: hasMore
        ? encodeCursor(pageRows.at(-1)!.cursorCreatedAt, pageRows.at(-1)!.id)
        : null,
      ...(total === undefined ? {} : { total }),
    };
  }

  async summary(documentId: string) {
    const workspaceId = this.requireWorkspaceId();
    const [row] = await this.db
      .select({ total: count() })
      .from(documentComments)
      .where(
        and(
          eq(documentComments.documentId, documentId),
          eq(documentComments.workspaceId, workspaceId),
          isNull(documentComments.deletedAt),
        ),
      );
    return { total: row?.total ?? 0 };
  }
}
