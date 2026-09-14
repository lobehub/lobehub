import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type {
  DocumentAnnotationAnchorMetadata,
  DocumentAnnotationItem,
  DocumentAnnotationStatus,
  NewDocumentAnnotation,
} from '../schemas';
import { documentAnnotations, documents } from '../schemas';
import type { LobeChatDatabase } from '../type';

export const DOCUMENT_ANNOTATION_DOCUMENT_NOT_FOUND = 'Document not found';
export const DOCUMENT_ANNOTATION_NOT_FOUND = 'Document annotation not found';

/** Raised when a caller writes against a stale annotation version. */
export class DocumentAnnotationConflictError extends Error {
  constructor(public readonly current: DocumentAnnotationItem) {
    super('Document annotation version conflict');
    this.name = 'DocumentAnnotationConflictError';
  }
}

export interface DocumentAnnotationInput {
  anchorMetadata?: DocumentAnnotationAnchorMetadata | null;
  author?: unknown;
  createdAt?: Date | string;
  id: string;
  kind?: string;
  /** Editor-compatible alias; persisted inside `anchorMetadata.nodeKeys`. */
  nodeKeys?: string[];
  payload?: unknown;
  quotedText?: string;
  status?: DocumentAnnotationStatus;
  updatedAt?: Date | string;
  /** Only used for legacy imports. Normal client writes use the server token. */
  version?: number;
}

export interface DocumentAnnotationPatch {
  anchorMetadata?: DocumentAnnotationAnchorMetadata | null;
  author?: unknown;
  kind?: string;
  nodeKeys?: string[];
  payload?: unknown;
  quotedText?: string;
  status?: DocumentAnnotationStatus;
}

export interface DocumentAnnotationUpsertResult {
  annotation: DocumentAnnotationItem;
  /** True when the id already existed and no data changed. */
  isDuplicate: boolean;
}

export interface DocumentAnnotationBulkResult {
  annotations: DocumentAnnotationItem[];
  createdCount: number;
  unchangedCount: number;
  /** Legacy imports never rewrite an existing database row. */
  updatedCount: number;
}

export interface ListDocumentAnnotationsOptions {
  includeDeleted?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneJson = <T>(value: T): T => {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through for values coming from a JSON column.
    }
  }
  // JSON columns are serializable by definition; keep a fallback for older
  // Node runtimes that do not expose structuredClone yet.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(value)) as T;
};

const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
    );
  }
  return false;
};

const asDate = (value: Date | string | undefined, fallback: Date): Date => {
  if (value === undefined) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const normalizedAnchorMetadata = (
  anchorMetadata: DocumentAnnotationAnchorMetadata | null | undefined,
  nodeKeys: string[] | undefined,
): DocumentAnnotationAnchorMetadata | null | undefined => {
  if (anchorMetadata === null && nodeKeys === undefined) return null;
  if (anchorMetadata === undefined && nodeKeys === undefined) return undefined;

  const result = isRecord(anchorMetadata) ? { ...anchorMetadata } : {};
  if (nodeKeys !== undefined) result.nodeKeys = [...nodeKeys];
  return result;
};

const nodeKeysFromAnchorMetadata = (anchorMetadata: unknown): string[] | undefined => {
  if (!isRecord(anchorMetadata) || !Array.isArray(anchorMetadata.nodeKeys)) return undefined;
  const nodeKeys = anchorMetadata.nodeKeys.filter(
    (value): value is string => typeof value === 'string',
  );
  return nodeKeys.length > 0 ? nodeKeys : [];
};

/**
 * Document annotation persistence with document-scope defense in depth.
 * Workspace ACL decisions (public/private and collaborator levels) belong to
 * the server router's resource permission service; this model prevents a
 * caller from crossing the personal/workspace document boundary underneath it.
 */
export class DocumentAnnotationModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private documentScope = (documentId: string) =>
    this.workspaceId
      ? and(eq(documents.id, documentId), eq(documents.workspaceId, this.workspaceId))
      : and(
          eq(documents.id, documentId),
          isNull(documents.workspaceId),
          eq(documents.userId, this.userId),
        );

  private assertDocument = async (db: LobeChatDatabase, documentId: string): Promise<void> => {
    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(this.documentScope(documentId))
      .limit(1);

    if (!document) throw new Error(DOCUMENT_ANNOTATION_DOCUMENT_NOT_FOUND);
  };

  private findScoped = async (
    db: LobeChatDatabase,
    documentId: string,
    id: string,
  ): Promise<DocumentAnnotationItem | undefined> => {
    const [annotation] = await db
      .select({ annotation: documentAnnotations })
      .from(documentAnnotations)
      .innerJoin(documents, eq(documents.id, documentAnnotations.documentId))
      .where(
        and(
          eq(documentAnnotations.id, id),
          eq(documentAnnotations.documentId, documentId),
          this.documentScope(documentId),
        ),
      )
      .limit(1);
    return annotation?.annotation;
  };

  private createValues = (
    documentId: string,
    input: DocumentAnnotationInput,
    now: Date,
  ): NewDocumentAnnotation => {
    const createdAt = asDate(input.createdAt, now);
    const anchorMetadata = normalizedAnchorMetadata(input.anchorMetadata, input.nodeKeys);
    return {
      anchorMetadata: anchorMetadata === undefined ? null : cloneJson(anchorMetadata),
      author: input.author === undefined ? null : cloneJson(input.author),
      createdAt,
      documentId,
      id: input.id,
      kind: input.kind ?? 'comment',
      payload: input.payload === undefined ? null : cloneJson(input.payload),
      quotedText: input.quotedText ?? '',
      status: input.status ?? 'active',
      updatedAt: asDate(input.updatedAt, now),
      userId: this.userId,
      version: Math.max(1, input.version ?? 1),
    };
  };

  private changed = (current: DocumentAnnotationItem, next: NewDocumentAnnotation): boolean =>
    current.documentId !== next.documentId ||
    current.kind !== next.kind ||
    current.quotedText !== next.quotedText ||
    current.status !== next.status ||
    !jsonEqual(current.author, next.author) ||
    !jsonEqual(current.payload, next.payload) ||
    !jsonEqual(current.anchorMetadata, next.anchorMetadata) ||
    (next.createdAt !== undefined && current.createdAt.getTime() !== next.createdAt.getTime()) ||
    (next.updatedAt !== undefined && current.updatedAt.getTime() !== next.updatedAt.getTime());

  private upsertWithin = async (
    db: LobeChatDatabase,
    documentId: string,
    input: DocumentAnnotationInput,
    expectedVersion?: number,
  ): Promise<DocumentAnnotationUpsertResult> => {
    const now = new Date();
    const current = await this.findScoped(db, documentId, input.id);

    if (!current) {
      const next = this.createValues(documentId, input, now);
      const [annotation] = await db
        .insert(documentAnnotations)
        .values(next)
        .onConflictDoNothing({ target: documentAnnotations.id })
        .returning();

      // A concurrent insert with the same globally unique id is retried as an
      // idempotent upsert, but only if it belongs to this document.
      if (annotation) return { annotation, isDuplicate: false };
      const raced = await this.findScoped(db, documentId, input.id);
      if (!raced) throw new Error(DOCUMENT_ANNOTATION_NOT_FOUND);
      if (expectedVersion !== undefined && raced.version !== expectedVersion) {
        throw new DocumentAnnotationConflictError(raced);
      }
      return { annotation: raced, isDuplicate: true };
    }

    // Upsert inputs are partial in practice (the editor usually omits an
    // author or timestamp). Preserve server-owned values for omitted fields so
    // a retry cannot turn an unchanged row into a new version.
    const next = this.createValues(documentId, input, now);
    if (input.anchorMetadata === undefined && input.nodeKeys === undefined) {
      next.anchorMetadata = current.anchorMetadata;
    }
    if (input.author === undefined) next.author = current.author;
    if (input.createdAt === undefined) next.createdAt = current.createdAt;
    if (input.kind === undefined) next.kind = current.kind;
    if (input.payload === undefined) next.payload = current.payload;
    if (input.quotedText === undefined) next.quotedText = current.quotedText;
    if (input.status === undefined) next.status = current.status;
    if (input.updatedAt === undefined) next.updatedAt = current.updatedAt;

    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new DocumentAnnotationConflictError(current);
    }

    if (!this.changed(current, next)) return { annotation: current, isDuplicate: true };

    const [annotation] = await db
      .update(documentAnnotations)
      .set({
        anchorMetadata: next.anchorMetadata,
        author: next.author,
        createdAt: current.createdAt,
        kind: next.kind,
        payload: next.payload,
        quotedText: next.quotedText,
        status: next.status,
        updatedAt: now,
        userId: current.userId,
        version: sql`${documentAnnotations.version} + 1`,
      })
      .where(
        and(
          eq(documentAnnotations.id, current.id),
          eq(documentAnnotations.documentId, documentId),
          expectedVersion === undefined
            ? undefined
            : eq(documentAnnotations.version, expectedVersion),
        ),
      )
      .returning();

    if (annotation) return { annotation, isDuplicate: false };
    const raced = await this.findScoped(db, documentId, input.id);
    if (!raced) throw new Error(DOCUMENT_ANNOTATION_NOT_FOUND);
    throw new DocumentAnnotationConflictError(raced);
  };

  /**
   * Import-only insert path. A legacy Yjs snapshot is a migration source, not
   * an authority: once an id exists in the database, even as a deleted
   * tombstone, it must never be replaced by an older client snapshot.
   */
  private insertLegacyWithin = async (
    db: LobeChatDatabase,
    documentId: string,
    input: DocumentAnnotationInput,
  ): Promise<{ annotation: DocumentAnnotationItem; created: boolean }> => {
    const next = this.createValues(documentId, input, new Date());
    const [annotation] = await db
      .insert(documentAnnotations)
      .values(next)
      .onConflictDoNothing({ target: documentAnnotations.id })
      .returning();

    if (annotation) return { annotation, created: true };

    const current = await this.findScoped(db, documentId, input.id);
    if (!current) throw new Error(DOCUMENT_ANNOTATION_NOT_FOUND);
    return { annotation: current, created: false };
  };

  listByDocument = async (
    documentId: string,
    options: ListDocumentAnnotationsOptions = {},
  ): Promise<DocumentAnnotationItem[]> => {
    await this.assertDocument(this.db, documentId);
    const conditions = [eq(documentAnnotations.documentId, documentId)];
    if (!options.includeDeleted) {
      conditions.push(
        // Keep the editor's AnnotationStatus-compatible rows in the default
        // snapshot; tombstones are available explicitly for reconciliation.
        sql`${documentAnnotations.status} <> 'deleted'`,
      );
    }
    return this.db
      .select({ annotation: documentAnnotations })
      .from(documentAnnotations)
      .innerJoin(documents, eq(documents.id, documentAnnotations.documentId))
      .where(and(...conditions, this.documentScope(documentId)))
      .orderBy(asc(documentAnnotations.createdAt), asc(documentAnnotations.id))
      .then((rows) => rows.map(({ annotation }) => annotation));
  };

  findById = async (
    documentId: string,
    id: string,
  ): Promise<DocumentAnnotationItem | undefined> => {
    await this.assertDocument(this.db, documentId);
    return this.findScoped(this.db, documentId, id);
  };

  create = async (
    documentId: string,
    input: DocumentAnnotationInput,
  ): Promise<DocumentAnnotationUpsertResult> => this.upsert(documentId, input);

  upsert = async (
    documentId: string,
    input: DocumentAnnotationInput,
    expectedVersion?: number,
  ): Promise<DocumentAnnotationUpsertResult> => {
    await this.assertDocument(this.db, documentId);
    return this.upsertWithin(this.db, documentId, input, expectedVersion);
  };

  bulkUpsertLegacy = async (
    documentId: string,
    records: DocumentAnnotationInput[],
  ): Promise<DocumentAnnotationBulkResult> => {
    const result = await this.db.transaction(async (trx) => {
      const db = trx as unknown as LobeChatDatabase;
      await this.assertDocument(db, documentId);

      // A retry or a malformed legacy snapshot can contain the same id more
      // than once. Keep the last copy within the submitted snapshot, while
      // never updating an id that already exists in the database.
      const deduped = [...new Map(records.map((record) => [record.id, record])).values()];
      let createdCount = 0;
      let unchangedCount = 0;
      const annotations: DocumentAnnotationItem[] = [];

      for (const record of deduped) {
        const current = await this.findScoped(db, documentId, record.id);
        // Existing rows are authoritative. This includes deleted tombstones:
        // an old embedded snapshot must not resurrect or overwrite them.
        if (current) {
          annotations.push(current);
          unchangedCount += 1;
          continue;
        }

        const inserted = await this.insertLegacyWithin(db, documentId, record);
        annotations.push(inserted.annotation);
        if (inserted.created) createdCount += 1;
        else unchangedCount += 1;
      }

      annotations.sort((left, right) => {
        const byDate = left.createdAt.getTime() - right.createdAt.getTime();
        return byDate || left.id.localeCompare(right.id);
      });
      return { annotations, createdCount, unchangedCount, updatedCount: 0 };
    });

    return result;
  };

  update = async (
    documentId: string,
    id: string,
    patch: DocumentAnnotationPatch,
    expectedVersion?: number,
  ): Promise<DocumentAnnotationItem> => {
    await this.assertDocument(this.db, documentId);
    const current = await this.findScoped(this.db, documentId, id);
    if (!current) throw new Error(DOCUMENT_ANNOTATION_NOT_FOUND);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new DocumentAnnotationConflictError(current);
    }

    const anchorMetadata = normalizedAnchorMetadata(patch.anchorMetadata, patch.nodeKeys);
    const values = {
      ...(anchorMetadata !== undefined ? { anchorMetadata: cloneJson(anchorMetadata) } : {}),
      ...(patch.author !== undefined ? { author: cloneJson(patch.author) } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.payload !== undefined ? { payload: cloneJson(patch.payload) } : {}),
      ...(patch.quotedText !== undefined ? { quotedText: patch.quotedText } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };

    if (Object.keys(values).length === 0) return current;

    const [annotation] = await this.db
      .update(documentAnnotations)
      .set({
        ...values,
        updatedAt: new Date(),
        version: sql`${documentAnnotations.version} + 1`,
      })
      .where(
        and(
          eq(documentAnnotations.id, id),
          eq(documentAnnotations.documentId, documentId),
          expectedVersion === undefined
            ? undefined
            : eq(documentAnnotations.version, expectedVersion),
        ),
      )
      .returning();

    if (annotation) return annotation;
    const raced = await this.findScoped(this.db, documentId, id);
    if (!raced) throw new Error(DOCUMENT_ANNOTATION_NOT_FOUND);
    throw new DocumentAnnotationConflictError(raced);
  };

  updateStatus = async (
    documentId: string,
    id: string,
    status: DocumentAnnotationStatus,
    expectedVersion?: number,
  ): Promise<DocumentAnnotationItem> => this.update(documentId, id, { status }, expectedVersion);

  softDelete = async (
    documentId: string,
    id: string,
    expectedVersion?: number,
  ): Promise<DocumentAnnotationItem> => {
    const current = await this.findById(documentId, id);
    if (!current) throw new Error(DOCUMENT_ANNOTATION_NOT_FOUND);
    if (current.status === 'deleted') return current;
    return this.updateStatus(documentId, id, 'deleted', expectedVersion);
  };

  remove = this.softDelete;
}

export const documentAnnotationRecordFromRow = (row: DocumentAnnotationItem) => ({
  author: row.author,
  createdAt: row.createdAt.toISOString(),
  documentId: row.documentId,
  id: row.id,
  kind: row.kind,
  nodeKeys: nodeKeysFromAnchorMetadata(row.anchorMetadata),
  payload: row.payload,
  quotedText: row.quotedText,
  status: row.status,
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

export const documentAnnotationRecordsFromRows = (rows: DocumentAnnotationItem[]) =>
  rows.map(documentAnnotationRecordFromRow);
