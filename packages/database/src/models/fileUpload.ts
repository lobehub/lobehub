import type { FileUploadSessionStatus } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, lte, or, sum } from 'drizzle-orm';

import type { FileUploadItem, NewFileUpload } from '../schemas';
import { fileUploads } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

const LIVE_STATUSES: FileUploadSessionStatus[] = ['active', 'cleaning'];
const TERMINAL_STATUSES: FileUploadSessionStatus[] = ['settled', 'released', 'expired'];

type Database = LobeChatDatabase | Transaction;

export class FileUploadModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    and(
      eq(fileUploads.userId, this.userId),
      this.workspaceId
        ? eq(fileUploads.workspaceId, this.workspaceId)
        : isNull(fileUploads.workspaceId),
    );

  create = async (
    params: Omit<NewFileUpload, 'id' | 'status' | 'userId' | 'workspaceId'>,
    transaction?: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await (transaction ?? this.db)
      .insert(fileUploads)
      .values({
        ...params,
        status: 'active',
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .onConflictDoNothing()
      .returning();

    return row;
  };

  findActiveByPathname = async (
    pathname: string,
    transaction?: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await (transaction ?? this.db)
      .select()
      .from(fileUploads)
      .where(
        and(this.ownership(), eq(fileUploads.pathname, pathname), eq(fileUploads.status, 'active')),
      )
      .limit(1);

    return row;
  };

  findLatestByPathname = async (
    pathname: string,
    transaction?: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await (transaction ?? this.db)
      .select()
      .from(fileUploads)
      .where(and(this.ownership(), eq(fileUploads.pathname, pathname)))
      .orderBy(desc(fileUploads.createdAt), desc(fileUploads.id))
      .limit(1);

    return row;
  };

  findLatestByPathnameForUpdate = async (
    pathname: string,
    transaction: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await transaction
      .select()
      .from(fileUploads)
      .where(and(this.ownership(), eq(fileUploads.pathname, pathname)))
      .orderBy(desc(fileUploads.createdAt), desc(fileUploads.id))
      .limit(1)
      .for('update');

    return row;
  };

  countLiveUsage = async (transaction?: Transaction): Promise<number> => {
    const [row] = await (transaction ?? this.db)
      .select({ totalSize: sum(fileUploads.size) })
      .from(fileUploads)
      .where(and(this.ownership(), inArray(fileUploads.status, LIVE_STATUSES)));

    return Number(row?.totalSize ?? 0);
  };

  static countLiveUsageForWorkspace = async (
    db: Database,
    workspaceId: string,
  ): Promise<number> => {
    const [row] = await db
      .select({ totalSize: sum(fileUploads.size) })
      .from(fileUploads)
      .where(
        and(eq(fileUploads.workspaceId, workspaceId), inArray(fileUploads.status, LIVE_STATUSES)),
      );

    return Number(row?.totalSize ?? 0);
  };

  static hasLivePathname = async (db: Database, pathname: string): Promise<boolean> => {
    const [row] = await db
      .select({ id: fileUploads.id })
      .from(fileUploads)
      .where(and(eq(fileUploads.pathname, pathname), inArray(fileUploads.status, LIVE_STATUSES)))
      .limit(1);

    return Boolean(row);
  };

  touchActive = async (
    pathname: string,
    expiresAt: Date,
    transaction?: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await (transaction ?? this.db)
      .update(fileUploads)
      .set({ expiresAt, updatedAt: new Date() })
      .where(
        and(this.ownership(), eq(fileUploads.pathname, pathname), eq(fileUploads.status, 'active')),
      )
      .returning();

    return row;
  };

  attachMultipartUpload = async (
    id: string,
    multipartUploadId: string,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await this.db
      .update(fileUploads)
      .set({ multipartUploadId, updatedAt: new Date() })
      .where(
        and(
          this.ownership(),
          eq(fileUploads.id, id),
          eq(fileUploads.status, 'active'),
          isNull(fileUploads.multipartUploadId),
        ),
      )
      .returning();

    return row;
  };

  markCompleted = async (id: string): Promise<FileUploadItem | undefined> => {
    const now = new Date();
    const [row] = await this.db
      .update(fileUploads)
      .set({ completedAt: now, updatedAt: now })
      .where(and(this.ownership(), eq(fileUploads.id, id), eq(fileUploads.status, 'active')))
      .returning();

    return row;
  };

  settle = async (
    id: string,
    fileId: string,
    transaction: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const now = new Date();
    const [row] = await transaction
      .update(fileUploads)
      .set({ completedAt: now, fileId, status: 'settled', updatedAt: now })
      .where(and(this.ownership(), eq(fileUploads.id, id), eq(fileUploads.status, 'active')))
      .returning();

    return row;
  };

  claimActiveForCleanup = async (
    pathname: string,
    transaction: Transaction,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await transaction
      .update(fileUploads)
      .set({ status: 'cleaning', updatedAt: new Date() })
      .where(
        and(this.ownership(), eq(fileUploads.pathname, pathname), eq(fileUploads.status, 'active')),
      )
      .returning();

    return row;
  };

  markReleased = async (id: string): Promise<FileUploadItem | undefined> => {
    const [row] = await this.db
      .update(fileUploads)
      .set({ status: 'released', updatedAt: new Date() })
      .where(and(this.ownership(), eq(fileUploads.id, id), eq(fileUploads.status, 'cleaning')))
      .returning();

    return row;
  };

  static claimExpiredBatch = async (
    db: LobeChatDatabase,
    params: { batchSize: number; cleanupLeaseBefore: Date; expiresBefore: Date },
  ): Promise<FileUploadItem[]> => {
    return db.transaction(async (transaction) => {
      const rows = await transaction
        .select({ id: fileUploads.id })
        .from(fileUploads)
        .where(
          or(
            and(eq(fileUploads.status, 'active'), lte(fileUploads.expiresAt, params.expiresBefore)),
            and(
              eq(fileUploads.status, 'cleaning'),
              lte(fileUploads.updatedAt, params.cleanupLeaseBefore),
            ),
          ),
        )
        .orderBy(asc(fileUploads.expiresAt), asc(fileUploads.id))
        .limit(params.batchSize)
        .for('update', { skipLocked: true });

      if (rows.length === 0) return [];

      return transaction
        .update(fileUploads)
        .set({ status: 'cleaning', updatedAt: new Date() })
        .where(
          inArray(
            fileUploads.id,
            rows.map(({ id }) => id),
          ),
        )
        .returning();
    });
  };

  static markExpired = async (
    db: LobeChatDatabase,
    id: string,
  ): Promise<FileUploadItem | undefined> => {
    const [row] = await db
      .update(fileUploads)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(fileUploads.id, id), eq(fileUploads.status, 'cleaning')))
      .returning();

    return row;
  };

  static deleteTerminalBatch = async (
    db: LobeChatDatabase,
    params: { batchSize: number; updatedBefore: Date },
  ): Promise<number> => {
    return db.transaction(async (transaction) => {
      const rows = await transaction
        .select({ id: fileUploads.id })
        .from(fileUploads)
        .where(
          and(
            inArray(fileUploads.status, TERMINAL_STATUSES),
            lte(fileUploads.updatedAt, params.updatedBefore),
          ),
        )
        .orderBy(asc(fileUploads.updatedAt), asc(fileUploads.id))
        .limit(params.batchSize)
        .for('update', { skipLocked: true });

      if (rows.length === 0) return 0;

      const deleted = await transaction
        .delete(fileUploads)
        .where(
          inArray(
            fileUploads.id,
            rows.map(({ id }) => id),
          ),
        )
        .returning({ id: fileUploads.id });

      return deleted.length;
    });
  };
}
