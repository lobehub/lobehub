import type { DocumentSharePermission, DocumentShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';

import { documents, documentShares, users } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface DocumentShareAccessResult {
  document: typeof documents.$inferSelect;
  isOwner: boolean;
  ownerAvatar: string | null;
  ownerDisplayName: string | null;
  pageViewCount: number;
  permission: DocumentSharePermission;
  visibility: DocumentShareVisibility;
}

export class DocumentShareModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (
    documentId: string,
    params: {
      permission?: DocumentSharePermission;
      visibility?: DocumentShareVisibility;
    } = {},
  ) => {
    const [doc] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, this.userId)))
      .limit(1);

    if (!doc) {
      throw new Error('Document not found or not owned by user');
    }

    const [result] = await this.db
      .insert(documentShares)
      .values({
        documentId,
        permission: params.permission ?? 'read',
        userId: this.userId,
        visibility: params.visibility ?? 'private',
      })
      .onConflictDoNothing({ target: documentShares.documentId })
      .returning();

    if (!result) {
      return this.getByDocumentId(documentId);
    }

    return result;
  };

  updateVisibility = async (documentId: string, visibility: DocumentShareVisibility) => {
    const [result] = await this.db
      .update(documentShares)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(documentShares.documentId, documentId), eq(documentShares.userId, this.userId)))
      .returning();

    return result || null;
  };

  updatePermission = async (documentId: string, permission: DocumentSharePermission) => {
    const [result] = await this.db
      .update(documentShares)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(documentShares.documentId, documentId), eq(documentShares.userId, this.userId)))
      .returning();

    return result || null;
  };

  deleteByDocumentId = async (documentId: string) => {
    return this.db
      .delete(documentShares)
      .where(
        and(eq(documentShares.documentId, documentId), eq(documentShares.userId, this.userId)),
      );
  };

  getByDocumentId = async (documentId: string) => {
    const result = await this.db
      .select({
        documentId: documentShares.documentId,
        id: documentShares.id,
        pageViewCount: documentShares.pageViewCount,
        permission: documentShares.permission,
        userId: documentShares.userId,
        visibility: documentShares.visibility,
      })
      .from(documentShares)
      .where(and(eq(documentShares.documentId, documentId), eq(documentShares.userId, this.userId)))
      .limit(1);

    return result[0] || null;
  };

  static findByDocumentId = async (db: LobeChatDatabase, documentId: string) => {
    const result = await db
      .select({
        document: documents,
        ownerAvatar: users.avatar,
        ownerDisplayName: users.fullName,
        pageViewCount: documentShares.pageViewCount,
        permission: documentShares.permission,
        shareUserId: documentShares.userId,
        visibility: documentShares.visibility,
      })
      .from(documents)
      .leftJoin(documentShares, eq(documentShares.documentId, documents.id))
      .leftJoin(users, eq(users.id, documents.userId))
      .where(eq(documents.id, documentId))
      .limit(1);

    return result[0] || null;
  };

  static incrementPageViewCount = async (db: LobeChatDatabase, documentId: string) => {
    await db
      .update(documentShares)
      .set({ pageViewCount: sql`${documentShares.pageViewCount} + 1` })
      .where(eq(documentShares.documentId, documentId));
  };

  static findByDocumentIdWithAccessCheck = async (
    db: LobeChatDatabase,
    documentId: string,
    accessUserId?: string,
  ): Promise<DocumentShareAccessResult> => {
    const row = await DocumentShareModel.findByDocumentId(db, documentId);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
    }

    const isOwner = !!accessUserId && row.document.userId === accessUserId;

    if (!isOwner) {
      const hasShare = !!row.visibility;
      if (!hasShare || row.visibility === 'private') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This page is private' });
      }
    }

    return {
      document: row.document,
      isOwner,
      ownerAvatar: row.ownerAvatar,
      ownerDisplayName: row.ownerDisplayName,
      pageViewCount: row.pageViewCount ?? 0,
      permission: (row.permission ?? 'read') as DocumentSharePermission,
      visibility: (row.visibility ?? 'private') as DocumentShareVisibility,
    };
  };
}
