import { CUSTOM_DOCUMENT_FILE_TYPE, CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import type { FileUploader, QueryFileListParams } from '@lobechat/types';
import {
  AI_GENERATED_FILE_SOURCES,
  FileSource,
  FilesTabs,
  LIBRARY_HIDDEN_FILE_SOURCES,
  ResourceSourceFilter,
  SortType,
} from '@lobechat/types';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias, type AnyPgColumn, unionAll } from 'drizzle-orm/pg-core';

import { DocumentModel } from '../../models/document';
import { FileModel } from '../../models/file';
import { DOCUMENT_FOLDER_TYPE, documents, files, knowledgeBaseFiles, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildDocumentCategoryFilter, buildFileCategoryFilter } from '../../utils/fileTypeCategory';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Both UNION arms reach the same two tables, and the file arm joins `documents`
 * to pick up the derived page that backs a file — so the tables are aliased
 * once here and every predicate below is an ordinary typed drizzle condition.
 */
const f = alias(files, 'f');
const d = alias(documents, 'd');

/**
 * The two arms of the resource UNION.
 *
 * A UNION matches columns by position, so the arms must expose the same keys in
 * the same order and with compatible types. Keeping them as two literals side
 * by side (rather than generating them) makes a mismatch visible in review; TS
 * catches it at the `unionAll` call either way.
 *
 * Plain column references carry their own output name (`f.chunk_task_id` →
 * `chunk_task_id`), which is what the sort keys reference — `ORDER BY` on a set
 * operation can only name an output column. Only fields whose output name has
 * to differ from the source column, or that are expressions, get an explicit
 * `.as()`: `f.id` would otherwise collide with the `id` column, and every
 * `users` column would land under its bare name.
 */
const fileArmColumns = {
  chunkTaskId: f.chunkTaskId,
  content: d.content,
  createdAt: f.createdAt,
  documentId: sql<string | null>`${d.id}`.as('document_id'),
  editorData: d.editorData,
  embeddingTaskId: f.embeddingTaskId,
  fileId: sql<string | null>`${f.id}`.as('file_id'),
  fileType: f.fileType,
  // A file that backs a derived page is addressed by the page id.
  id: sql<string>`COALESCE(${d.id}, ${f.id})`.as('id'),
  metadata: sql<Record<string, any> | null>`COALESCE(${d.metadata}, ${f.metadata})`.as('metadata'),
  name: f.name,
  size: f.size,
  slug: d.slug,
  sourceType: sql<'file' | 'document'>`'file'`.as('source_type'),
  updatedAt: f.updatedAt,
  uploaderAvatar: sql<string | null>`${users.avatar}`.as('uploader_avatar'),
  uploaderFullName: sql<string | null>`${users.fullName}`.as('uploader_full_name'),
  uploaderId: sql<string | null>`${users.id}`.as('uploader_id'),
  uploaderUsername: sql<string | null>`${users.username}`.as('uploader_username'),
  url: f.url,
  userId: f.userId,
  visibility: f.visibility,
};

const documentArmColumns = {
  chunkTaskId: sql<string | null>`NULL::uuid`.as('chunk_task_id'),
  content: d.content,
  createdAt: d.createdAt,
  documentId: sql<string | null>`${d.id}`.as('document_id'),
  editorData: d.editorData,
  embeddingTaskId: sql<string | null>`NULL::uuid`.as('embedding_task_id'),
  fileId: d.fileId,
  fileType: d.fileType,
  id: d.id,
  metadata: d.metadata,
  name: sql<string>`COALESCE(${d.title}, ${d.filename}, 'Untitled')`.as('name'),
  size: sql<number>`${d.totalCharCount}`.as('size'),
  slug: d.slug,
  sourceType: sql<'file' | 'document'>`'document'`.as('source_type'),
  updatedAt: d.updatedAt,
  uploaderAvatar: sql<string | null>`${users.avatar}`.as('uploader_avatar'),
  uploaderFullName: sql<string | null>`${users.fullName}`.as('uploader_full_name'),
  uploaderId: sql<string | null>`${users.id}`.as('uploader_id'),
  uploaderUsername: sql<string | null>`${users.username}`.as('uploader_username'),
  url: sql<string>`${d.source}`.as('url'),
  userId: d.userId,
  visibility: d.visibility,
};

/** One row as the UNION returns it, before it is shaped into a `KnowledgeItem`. */
interface KnowledgeRow {
  chunkTaskId: string | null;
  content: string | null;
  createdAt: Date;
  documentId: string | null;
  editorData: Record<string, any> | null;
  embeddingTaskId: string | null;
  fileId: string | null;
  fileType: string;
  id: string;
  metadata: Record<string, any> | null;
  name: string;
  size: number;
  slug: string | null;
  sourceType: 'file' | 'document';
  updatedAt: Date;
  uploaderAvatar: string | null;
  uploaderFullName: string | null;
  uploaderId: string | null;
  uploaderUsername: string | null;
  url: string | null;
  userId: string | null;
  visibility: 'private' | 'public' | null;
}

/** Sort keys the client may pass, mapped to the UNION's output column names. */
const SORTABLE_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  name: 'name',
  size: 'size',
  updatedAt: 'updated_at',
};

export interface KnowledgeItem {
  chunkTaskId?: string | null;
  content?: string | null;
  createdAt: Date;
  documentId?: string | null;
  editorData?: Record<string, any> | null;
  embeddingTaskId?: string | null;
  fileId?: string | null;
  fileType: string;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  size: number;
  slug?: string | null;
  /**
   * Source type to distinguish between files and documents
   * - 'file': from files table
   * - 'document': from documents table
   */
  sourceType: 'file' | 'document';
  updatedAt: Date;
  uploader?: FileUploader | null;
  url?: string;
  /** Workspace creator id (used by UI to decide if current user owns the row). */
  userId?: string | null;
  /**
   * Workspace visibility. `null` when querying in personal mode (column is
   * ignored). UI uses this together with `userId` to surface the lock icon
   * and the publish-to-workspace affordance.
   */
  visibility?: 'private' | 'public' | null;
}

/**
 * Kind of row a recent query is after:
 * - `file` — uploaded files, excluding the file rows that back a derived page
 * - `page` — derived pages / notes, excluding folders
 */
export type RecentItemKind = 'file' | 'page';

interface KnowledgeQueryParams extends QueryFileListParams {
  /** Restrict the result set to rows created by a specific workspace member. */
  creatorUserId?: string;
  /**
   * Server-derived list of restricted knowledge bases the caller may not
   * browse (resource-permission `use` level). Content linked to these KBs is
   * dropped from cross-KB listings; never populated from client input.
   */
  excludeKnowledgeBaseIds?: string[];
}

/**
 * `metadata` is the one column still selected through an expression (the file
 * arm coalesces the page's metadata over the file's), so it skips drizzle's
 * jsonb decoder and the drivers disagree on what they hand back — neon returns
 * a string, node-postgres a parsed object. Everything else is a plain column
 * and arrives already decoded.
 */
const toJson = (value: unknown): Record<string, any> | null => {
  if (typeof value !== 'string') return (value as Record<string, any> | null) ?? null;

  try {
    return JSON.parse(value);
  } catch (e) {
    console.error('[KnowledgeRepo] Failed to parse JSON column:', e);
    return null;
  }
};

const toKnowledgeItem = (row: KnowledgeRow): KnowledgeItem => ({
  chunkTaskId: row.chunkTaskId,
  content: row.content,
  createdAt: row.createdAt,
  documentId: row.documentId,
  editorData: row.editorData,
  embeddingTaskId: row.embeddingTaskId,
  fileId: row.fileId,
  fileType: row.fileType,
  id: row.id,
  metadata: toJson(row.metadata),
  name: row.name,
  size: Number(row.size),
  slug: row.slug,
  sourceType: row.sourceType,
  updatedAt: row.updatedAt,
  uploader: row.uploaderId
    ? {
        avatar: row.uploaderAvatar,
        fullName: row.uploaderFullName,
        id: row.uploaderId,
        username: row.uploaderUsername,
      }
    : null,
  url: row.url ?? undefined,
  userId: row.userId,
  visibility: row.visibility,
});

/**
 * Resources Repository - combines files and documents into a unified interface
 */
export class KnowledgeRepo {
  private userId: string;
  private db: LobeChatDatabase;
  private fileModel: FileModel;
  private documentModel: DocumentModel;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, userId, workspaceId);
  }

  private scope = () => ({ userId: this.userId, workspaceId: this.workspaceId });

  /**
   * Scope predicate every file listing shares: ownership plus the exclusion of
   * sources that belong to another surface (acceptance evidence). Kept as one
   * helper so a new listing can't accidentally pick up ownership alone and
   * start leaking hundreds of verification artifacts back into the library.
   *
   * `sourceFilter` is the only opt-out: asking for `acceptance` explicitly is a
   * request for exactly the rows this predicate otherwise hides, so the
   * exclusion is dropped and `fileSourceFilter` narrows to them instead.
   */
  private fileScope = (sourceFilter?: ResourceSourceFilter) =>
    and(
      buildWorkspaceWhere(this.scope(), f),
      sourceFilter === ResourceSourceFilter.Acceptance
        ? undefined
        : or(isNull(f.source), notInArray(f.source, LIBRARY_HIDDEN_FILE_SOURCES)),
    );

  private documentScope = () => buildWorkspaceWhere(this.scope(), d);

  /**
   * Narrow a workspace-scoped list to one Resources mode. Personal rows are
   * already owner-scoped and deliberately ignore the mode filter.
   */
  private visibilityFilter = (
    visibility: QueryFileListParams['visibility'],
    column: AnyPgColumn,
  ): SQL | undefined => {
    if (!this.workspaceId || !visibility) return undefined;

    return visibility === 'private'
      ? eq(column, 'private')
      : (or(eq(column, 'public'), isNull(column)) as SQL);
  };

  /**
   * Filters shared by both arms. `visibility` narrows the ownership-scoped pool;
   * rows predating the column count as public.
   */
  private commonFilters = (
    { creatorUserId, parentId, q, visibility }: KnowledgeQueryParams,
    cols: {
      names: AnyPgColumn[];
      parentId: AnyPgColumn;
      userId: AnyPgColumn;
      visibility: AnyPgColumn;
    },
  ): (SQL | undefined)[] => [
    creatorUserId ? eq(cols.userId, creatorUserId) : undefined,
    parentId === undefined
      ? undefined
      : parentId === null
        ? isNull(cols.parentId)
        : eq(cols.parentId, parentId),
    q ? or(...cols.names.map((name) => ilike(name, `%${q}%`))) : undefined,
    this.visibilityFilter(visibility, cols.visibility),
  ];

  private fileArm = (
    where: (SQL | undefined)[],
    knowledgeBaseId?: string,
    sourceFilter?: ResourceSourceFilter,
  ) => {
    let query = this.db.select(fileArmColumns).from(f).$dynamic();

    if (knowledgeBaseId) {
      query = query.innerJoin(
        knowledgeBaseFiles,
        and(
          eq(knowledgeBaseFiles.fileId, f.id),
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
        ),
      );
    }

    return query
      .leftJoin(d, eq(d.fileId, f.id))
      .leftJoin(users, eq(users.id, f.userId))
      .where(and(this.fileScope(sourceFilter), ...where));
  };

  private documentArm = (where: (SQL | undefined)[]) =>
    this.db
      .select(documentArmColumns)
      .from(d)
      .leftJoin(users, eq(users.id, d.userId))
      .where(and(this.documentScope(), ne(d.sourceType, 'file'), ...where));

  /**
   * Query combined results from files and documents tables
   */
  async query({
    category,
    creatorUserId,
    q,
    sortType,
    sorter,
    excludeKnowledgeBaseIds,
    knowledgeBaseId,
    showFilesInKnowledgeBase,
    parentId,
    limit = 50,
    offset = 0,
    sourceFilter,
    visibility,
  }: KnowledgeQueryParams = {}): Promise<KnowledgeItem[]> {
    // If parentId is provided, check if it's a slug and resolve it to an ID
    let resolvedParentId = parentId;
    if (parentId) {
      // Try to find a document with this slug
      const docBySlug = await this.documentModel.findBySlug(parentId);
      if (docBySlug) {
        resolvedParentId = docBySlug.id;
      }
      // Otherwise assume it's already an ID
    }

    // Visibility filter is only meaningful in workspace mode. Personal-mode
    // rows have `visibility` set to the schema default and are already fully
    // scoped by `workspace_id IS NULL AND user_id = caller`.
    const shared: KnowledgeQueryParams = {
      creatorUserId,
      parentId: resolvedParentId,
      q,
      visibility: this.workspaceId ? visibility : undefined,
    };

    const fileArm = this.fileArm(
      [
        ...this.commonFilters(shared, {
          names: [f.name],
          parentId: f.parentId,
          userId: f.userId,
          visibility: f.visibility,
        }),
        this.fileCategoryFilter(category),
        this.fileSourceFilter(sourceFilter),
        // Exclude files in knowledge base if needed
        !knowledgeBaseId && !showFilesInKnowledgeBase ? this.notInAnyKnowledgeBase() : undefined,
        !knowledgeBaseId && excludeKnowledgeBaseIds?.length
          ? this.notInKnowledgeBases(excludeKnowledgeBaseIds)
          : undefined,
      ],
      knowledgeBaseId,
      sourceFilter,
    );

    const documentArm = this.documentArm([
      ...this.commonFilters(shared, {
        names: [d.title, d.filename],
        parentId: d.parentId,
        userId: d.userId,
        visibility: d.visibility,
      }),
      this.documentCategoryFilter(category),
      this.documentSourceFilter(sourceFilter),
      // Inside a knowledge base only standalone rows (folders and notes with no
      // backing file) belong to the document arm — documents that do have a file
      // already come back through the file arm.
      knowledgeBaseId ? isNull(d.fileId) : undefined,
      knowledgeBaseId ? eq(d.knowledgeBaseId, knowledgeBaseId) : undefined,
      !knowledgeBaseId && excludeKnowledgeBaseIds?.length
        ? or(isNull(d.knowledgeBaseId), notInArray(d.knowledgeBaseId, excludeKnowledgeBaseIds))
        : undefined,
    ]);

    const rows = await unionAll(fileArm, documentArm)
      .orderBy(this.orderBy(sortType, sorter))
      .limit(limit)
      .offset(offset);

    return rows.map(toKnowledgeItem);
  }

  /**
   * Query recent items (files and documents)
   * Returns the most recently updated items
   *
   * `kind` narrows the result to uploaded files or derived pages. The narrowing
   * has to happen inside SQL: filtering the combined list afterwards lets
   * `LIMIT` truncate away every row of the wanted kind — a burst of uploads
   * left the resource home with an empty "recent pages" section.
   */
  async queryRecent(
    limit: number = 12,
    kind?: RecentItemKind,
    visibility?: QueryFileListParams['visibility'],
  ): Promise<KnowledgeItem[]> {
    const fileArm = this.fileArm([
      this.notInAnyKnowledgeBase(),
      this.visibilityFilter(visibility, f.visibility),
      // Derived pages live in the documents table; their backing file row is not
      // a file the user uploaded, so it never belongs to the file list.
      kind === 'file' ? ne(f.fileType, CUSTOM_DOCUMENT_FILE_TYPE) : undefined,
    ]);

    const documentArm = this.documentArm([
      isNull(d.knowledgeBaseId),
      this.visibilityFilter(visibility, d.visibility),
      // Folders are containers, not pages.
      kind === 'page' ? ne(d.fileType, CUSTOM_FOLDER_FILE_TYPE) : undefined,
    ]);

    const recent =
      kind === 'file' ? fileArm : kind === 'page' ? documentArm : unionAll(fileArm, documentArm);

    const rows = await recent.orderBy(this.orderBy(SortType.Desc, 'updatedAt')).limit(limit);

    return rows.map(toKnowledgeItem);
  }

  /**
   * Delete item by id - routes to appropriate model based on sourceType
   */
  async deleteItem(id: string, sourceType: 'file' | 'document'): Promise<void> {
    if (sourceType === 'file') {
      await this.fileModel.delete(id);
    } else {
      await this.deleteDocumentWithRelations(id);
    }
  }

  /**
   * Batch delete items
   */
  async deleteMany(items: Array<{ id: string; sourceType: 'file' | 'document' }>): Promise<void> {
    const fileIds = items.filter((item) => item.sourceType === 'file').map((item) => item.id);
    const documentIds = items
      .filter((item) => item.sourceType === 'document')
      .map((item) => item.id);

    await Promise.all([
      fileIds.length > 0 ? this.fileModel.deleteMany(fileIds) : Promise.resolve(),
      documentIds.length > 0
        ? Promise.all(documentIds.map((id) => this.deleteDocumentWithRelations(id)))
        : Promise.resolve(),
    ]);
  }

  /**
   * Find item by id
   */
  async findById(id: string, sourceType: 'file' | 'document'): Promise<any> {
    if (sourceType === 'file') {
      return this.fileModel.findById(id);
    } else {
      return this.documentModel.findById(id);
    }
  }

  private deleteDocumentWithRelations = async (id: string): Promise<void> => {
    const document = await this.documentModel.findById(id);
    if (!document) return;

    if (document.fileType === DOCUMENT_FOLDER_TYPE) {
      const children = await this.db.query.documents.findMany({
        where: and(eq(documents.parentId, id), buildWorkspaceWhere(this.scope(), documents)),
      });

      for (const child of children) {
        await this.deleteDocumentWithRelations(child.id);
      }

      const childFiles = await this.db.query.files.findMany({
        where: and(eq(files.parentId, id), buildWorkspaceWhere(this.scope(), files)),
      });

      for (const file of childFiles) {
        await this.fileModel.delete(file.id);
      }
    }

    if (document.fileId) {
      await this.fileModel.delete(document.fileId);
    }

    await this.documentModel.delete(id);
  };

  private notInAnyKnowledgeBase = () =>
    notExists(this.db.select().from(knowledgeBaseFiles).where(eq(knowledgeBaseFiles.fileId, f.id)));

  /**
   * Drop files linked to any of the given knowledge bases. A file that also
   * belongs to an open KB is still dropped — hiding slightly more beats
   * leaking a restricted KB's content through a shared membership.
   */
  private notInKnowledgeBases = (knowledgeBaseIds: string[]) =>
    notExists(
      this.db
        .select()
        .from(knowledgeBaseFiles)
        .where(
          and(
            eq(knowledgeBaseFiles.fileId, f.id),
            inArray(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseIds),
          ),
        ),
    );

  private fileCategoryFilter = (category?: string): SQL | undefined => {
    if (!category || category === FilesTabs.All) return undefined;

    const filter = buildFileCategoryFilter(f.fileType, category as FilesTabs);
    if (filter === 'all') return undefined;
    // `false` drops the arm from the UNION — a category the table can't serve.
    return filter === 'none' ? sql`false` : filter;
  };

  /**
   * Origin narrowing on `files.source`. Uploads are defined by exclusion rather
   * than by `IS NULL` alone: an image pasted into the page editor carries
   * `page-editor` and is still something the user put there, so anything that
   * isn't machine-generated or foreign-owned counts as an upload.
   */
  private fileSourceFilter = (sourceFilter?: ResourceSourceFilter): SQL | undefined => {
    switch (sourceFilter) {
      case ResourceSourceFilter.Acceptance: {
        return eq(f.source, FileSource.Acceptance);
      }
      case ResourceSourceFilter.Generated: {
        return inArray(f.source, AI_GENERATED_FILE_SOURCES);
      }
      case ResourceSourceFilter.Uploaded: {
        return or(
          isNull(f.source),
          notInArray(f.source, [...AI_GENERATED_FILE_SOURCES, ...LIBRARY_HIDDEN_FILE_SOURCES]),
        );
      }
      default: {
        return undefined;
      }
    }
  };

  /**
   * Origin is a file-level notion — documents have no `source` of this kind — so
   * any narrowing at all drops the document arm from the UNION. `all` leaves it
   * untouched.
   */
  private documentSourceFilter = (sourceFilter?: ResourceSourceFilter): SQL | undefined =>
    !sourceFilter || sourceFilter === ResourceSourceFilter.All ? undefined : sql`false`;

  /**
   * Document rows only surface under All and Pages; every file-oriented category
   * (Documents included) excludes the table entirely.
   */
  private documentCategoryFilter = (category?: string): SQL | undefined => {
    if (!category || category === FilesTabs.All) return undefined;

    const filter = buildDocumentCategoryFilter(d.fileType, category as FilesTabs);
    if (filter === 'all') return undefined;
    return filter === 'none' ? sql`false` : filter;
  };

  /**
   * Both halves of the sort have to be supplied to take effect — a `sorter`
   * without a `sortType` falls back to newest-first, as it always has.
   *
   * `sql.raw` is required rather than a column reference: after a set operation
   * `ORDER BY` may only name an output column, and `"f"."name"` is not one. The
   * value is looked up in `SORTABLE_COLUMNS`, never taken from the caller.
   */
  private orderBy = (sortType?: string, sorter?: string): SQL => {
    if (!sorter || !sortType || !(sorter in SORTABLE_COLUMNS)) return desc(sql.raw('created_at'));

    const direction = sortType.toLowerCase() === SortType.Asc ? asc : desc;

    return direction(sql.raw(SORTABLE_COLUMNS[sorter]));
  };
}
