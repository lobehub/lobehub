import { and, asc, count, desc, eq, inArray, isNull, ne, notInArray, or, sum } from 'drizzle-orm';

import type { DocumentItem, NewDocument, TrashDetachedEdge } from '../schemas';
import {
  DOCUMENT_FOLDER_TYPE,
  documentCommentMentions,
  documentComments,
  documentLikes,
  documents,
  files,
  works,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { lockDocumentHierarchy } from '../utils/documentHierarchy';
import { excludeRestrictedDocument } from '../utils/restrictedKnowledgeBase';
import {
  isTrashed,
  notTrashed,
  restoreStamp,
  type SoftDeleteOptions,
  trashStamp,
} from '../utils/softDelete';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface QueryDocumentParams {
  current?: number;
  /**
   * Knowledge-base ids whose documents must be dropped from the listing —
   * restricted (member No-access) libraries. Applied inside the query so
   * pagination and totals stay correct.
   */
  excludeKnowledgeBaseIds?: string[];
  /** Deleted restricted KBs; only otherwise-unshared content is hidden. */
  excludeTrashedKnowledgeBaseIds?: string[];
  fileTypes?: string[];
  pageSize?: number;
  sourceTypes?: string[];
}

export const DOCUMENT_TRANSFER_FOREIGN_ROWS =
  'Document subtree contains content created by other users';
export const DOCUMENT_PARENT_NOT_FOUND = 'Parent document not found';

export class DocumentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  /**
   * Visibility of the agent that owns the calling tool execution, when this
   * model is instantiated inside a tool runtime. `'public'` tightens
   * `ownership()` so a workspace-shared agent cannot see the caller's own
   * private documents — mirrors the task side's `assertAgentVisibilityCompat`.
   * `undefined` / `'private'` / `null` leave the standard filter in place, so
   * a private agent (or a direct TRPC call from the user) still sees the
   * caller's private docs as normal.
   */
  private callerAgentVisibility?: 'private' | 'public' | null;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    callerAgentVisibility?: 'private' | 'public' | null,
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.callerAgentVisibility = callerAgentVisibility;
  }

  private ownership = (includeTrashed?: boolean) =>
    buildWorkspaceWhere(
      {
        callerAgentVisibility: this.callerAgentVisibility,
        includeTrashed,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      documents,
    );

  findOrCreateFolder = async (name: string, parentId?: string): Promise<DocumentItem> => {
    const existing = await this.db.query.documents.findFirst({
      where: and(
        this.ownership(),
        eq(documents.fileType, DOCUMENT_FOLDER_TYPE),
        eq(documents.filename, name),
        parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
      ),
    });

    if (existing) return existing;

    return this.create({
      content: '',
      fileType: DOCUMENT_FOLDER_TYPE,
      filename: name,
      parentId,
      source: '',
      sourceType: 'api',
      title: name,
      totalCharCount: 0,
      totalLineCount: 0,
    });
  };

  create = async (
    params: Omit<NewDocument, 'userId'>,
    trx?: Transaction,
  ): Promise<DocumentItem> => {
    // Workspace-mode default for visibility:
    //   - explicit visibility wins
    //   - user-authored Pages (`sourceType: 'api'`) default to
    //     `'private'` so workspace members start drafts in their own space and
    //     publish when ready
    //   - all other top-level rows (web crawls, file ingests, topic snapshots,
    //     agent-signal artifacts, …): leave the schema default (`'public'`) so
    //     existing behavior is preserved — these don't have a Pages-style
    //     draft / publish lifecycle and were workspace-shared from day one
    // Personal mode leaves it to the schema default; the filter ignores it.
    let visibility = params.visibility;
    if (!visibility && this.workspaceId && params.sourceType === 'api') {
      visibility = 'private';
    }

    const insert = async (db: LobeChatDatabase): Promise<DocumentItem> => {
      if (params.parentId) {
        await lockDocumentHierarchy(db, this.userId, this.workspaceId);
        const parent = await db.query.documents.findFirst({
          where: and(eq(documents.id, params.parentId), notTrashed(documents.isDeleted)),
        });
        if (!parent) throw new Error(DOCUMENT_PARENT_NOT_FOUND);
      }

      const result = (await db
        .insert(documents)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            { ...params, ...(visibility ? { visibility } : {}) },
          ),
        )
        .returning()) as DocumentItem[];

      return result[0]!;
    };

    if (trx) return insert(trx as unknown as LobeChatDatabase);
    if (!params.parentId) return insert(this.db);
    return this.db.transaction((tx) => insert(tx as unknown as LobeChatDatabase));
  };

  delete = async (id: string) => {
    return this.db.delete(documents).where(and(eq(documents.id, id), this.ownership()));
  };

  deleteMany = async (ids: string[]) => {
    if (ids.length === 0) return [];
    return this.db
      .delete(documents)
      .where(and(inArray(documents.id, ids), this.ownership()))
      .returning({ id: documents.id });
  };

  deleteAll = async () => {
    return this.db.delete(documents).where(this.ownership());
  };

  query = async ({
    current = 0,
    pageSize = 9999,
    excludeKnowledgeBaseIds,
    excludeTrashedKnowledgeBaseIds,
    fileTypes,
    sourceTypes,
  }: QueryDocumentParams = {}): Promise<{
    items: DocumentItem[];
    total: number;
  }> => {
    const offset = current * pageSize;
    const conditions = [this.ownership()];

    if (fileTypes?.length) {
      conditions.push(inArray(documents.fileType, fileTypes));
    }

    const restrictedFilter = excludeRestrictedDocument(
      this.db,
      { fileId: documents.fileId, knowledgeBaseId: documents.knowledgeBaseId },
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        liveKnowledgeBaseIds: excludeKnowledgeBaseIds,
        trashedKnowledgeBaseIds: excludeTrashedKnowledgeBaseIds,
      },
    );
    if (restrictedFilter) conditions.push(restrictedFilter);

    if (sourceTypes?.length) {
      conditions.push(
        inArray(
          documents.sourceType,
          sourceTypes as ('file' | 'web' | 'api' | 'topic' | 'agent' | 'agent-signal')[],
        ),
      );
    } else {
      conditions.push(notInArray(documents.sourceType, ['agent', 'agent-signal']));
    }

    const whereCondition = and(...conditions);

    // Fetch items and total count in parallel
    // Optimize: Exclude large JSONB fields (content, pages, editorData) for better performance
    const [rawItems, totalResult] = await Promise.all([
      this.db
        .select({
          accessedAt: documents.accessedAt,
          clientId: documents.clientId,
          createdAt: documents.createdAt,
          fileId: documents.fileId,
          fileType: documents.fileType,
          filename: documents.filename,
          id: documents.id,
          metadata: documents.metadata,
          parentId: documents.parentId,
          slug: documents.slug,
          source: documents.source,
          sourceType: documents.sourceType,
          title: documents.title,
          totalCharCount: documents.totalCharCount,
          totalLineCount: documents.totalLineCount,
          updatedAt: documents.updatedAt,
          userId: documents.userId,
          // Sidebar bucket selectors read `visibility` / `workspaceId` to split
          // Pages between the "Private" and "Workspace" accordions — omitting
          // them silently drops every row into the workspace bucket.
          visibility: documents.visibility,
          workspaceId: documents.workspaceId,
          // Exclude large fields: content, pages, editorData
        })
        .from(documents)
        .where(whereCondition)
        .orderBy(desc(documents.updatedAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count(documents.id) })
        .from(documents)
        .where(whereCondition),
    ]);

    // Map to DocumentItem type with excluded fields as null
    const items = rawItems.map((item) => ({
      ...item,
      content: null,
      editorData: null,
      pages: null,
    })) as DocumentItem[];

    return { items, total: totalResult[0].count };
  };

  findById = async (id: string): Promise<DocumentItem | undefined> => {
    return this.db.query.documents.findFirst({
      where: and(this.ownership(), eq(documents.id, id)),
    });
  };

  findByIds = async (ids: string[]): Promise<DocumentItem[]> => {
    if (ids.length === 0) return [];
    return this.db.query.documents.findMany({
      where: and(this.ownership(), inArray(documents.id, ids)),
    });
  };

  findTrashedByIds = async (ids: string[]): Promise<DocumentItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(documents)
      .where(and(this.ownership(true), inArray(documents.id, ids), isTrashed(documents.isDeleted)));
  };

  /**
   * Whether a parent is trashed inside this model's exact personal/workspace scope.
   * This intentionally ignores workspace visibility because restoring a visible
   * child beneath any trashed parent would create a live orphaned subtree. It
   * returns only a boolean and must not be used to authorize or expose the parent.
   */
  isTrashedParent = async (id: string): Promise<boolean> => {
    return this.hasTrashedParents([id]);
  };

  hasTrashedParents = async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return false;
    const [row] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          inArray(documents.id, ids),
          isTrashed(documents.isDeleted),
          this.workspaceId
            ? eq(documents.workspaceId, this.workspaceId)
            : and(isNull(documents.workspaceId), eq(documents.userId, this.userId)),
        ),
      )
      .limit(1);

    return Boolean(row);
  };

  /**
   * Whether every referenced parent still exists as a live document in this exact scope.
   * Restore paths use this after locking the hierarchy: a parent transferred out of scope is as
   * unusable as a trashed parent because retaining that parentId would create an unreachable row.
   */
  hasUnrestorableParents = async (ids: string[]): Promise<boolean> => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return false;
    const rows = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          inArray(documents.id, uniqueIds),
          notTrashed(documents.isDeleted),
          this.workspaceId
            ? eq(documents.workspaceId, this.workspaceId)
            : and(isNull(documents.workspaceId), eq(documents.userId, this.userId)),
        ),
      );

    return rows.length !== uniqueIds.length;
  };

  findByFileIds = async (fileIds: string[]): Promise<DocumentItem[]> => {
    if (fileIds.length === 0) return [];
    return this.db
      .select()
      .from(documents)
      .where(and(this.ownership(), inArray(documents.fileId, fileIds)));
  };

  softDelete = async (ids: string[], options: SoftDeleteOptions): Promise<DocumentItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .update(documents)
      .set(trashStamp(options.deletedAt))
      .where(
        and(
          this.ownership(),
          inArray(documents.id, ids),
          options.restrictToCreator ? eq(documents.userId, this.userId) : undefined,
        ),
      )
      .returning();
  };

  softDeleteSubtree = async (
    rootId: string,
    options: SoftDeleteOptions,
  ): Promise<{ detachedEdges: TrashDetachedEdge[]; documents: DocumentItem[] }> => {
    return this.softDeleteSubtrees([rootId], options);
  };

  /**
   * Soft-delete several document trees under one hierarchy lock. Descendants
   * shared by overlapping roots are collected and stamped only once.
   */
  softDeleteSubtrees = async (
    rootIds: string[],
    options: SoftDeleteOptions,
  ): Promise<{ detachedEdges: TrashDetachedEdge[]; documents: DocumentItem[] }> => {
    if (rootIds.length === 0) return { detachedEdges: [], documents: [] };
    await lockDocumentHierarchy(this.db, this.userId, this.workspaceId);
    const subtree = await this.collectSubtrees(rootIds);
    if (subtree.length === 0) return { detachedEdges: [], documents: [] };
    const ids = subtree
      .filter((document) => !options.restrictToCreator || document.userId === this.userId)
      .map((document) => document.id);
    if (ids.length === 0) return { detachedEdges: [], documents: [] };

    let detachedEdges: TrashDetachedEdge[] = [];
    if (this.workspaceId) {
      // A public folder may contain another member's private subtree. Keep
      // retained boundary nodes reachable without reading or exposing them to
      // the actor: move only their roots to the workspace top level, remember
      // the original edges for restore, and leave each private subtree intact.
      const boundaryDocuments = await this.db
        .select({ originalParentId: documents.parentId, resourceId: documents.id })
        .from(documents)
        .where(
          and(
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              {
                isDeleted: documents.isDeleted,
                userId: documents.userId,
                workspaceId: documents.workspaceId,
              },
            ),
            inArray(documents.parentId, ids),
            notInArray(documents.id, ids),
          ),
        )
        .for('update');

      detachedEdges = boundaryDocuments
        .filter((edge): edge is { originalParentId: string; resourceId: string } =>
          Boolean(edge.originalParentId),
        )
        .map((edge) => ({ ...edge, resourceType: 'document' }));

      if (detachedEdges.length > 0) {
        await this.db
          .update(documents)
          .set({ parentId: null })
          .where(
            inArray(
              documents.id,
              detachedEdges.map((edge) => edge.resourceId),
            ),
          );
      }
    }

    const trashedDocuments = await this.db
      .update(documents)
      .set(trashStamp(options.deletedAt))
      .where(and(this.ownership(), inArray(documents.id, ids)))
      .returning();

    return { detachedEdges, documents: trashedDocuments };
  };

  restoreDetachedParents = async (edges: TrashDetachedEdge[]): Promise<void> => {
    if (!this.workspaceId || edges.length === 0) return;

    const byParent = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.resourceType !== 'document') continue;
      const ids = byParent.get(edge.originalParentId) ?? [];
      ids.push(edge.resourceId);
      byParent.set(edge.originalParentId, ids);
    }

    for (const [parentId, ids] of byParent) {
      await this.db
        .update(documents)
        .set({ parentId })
        .where(
          and(
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              {
                isDeleted: documents.isDeleted,
                userId: documents.userId,
                workspaceId: documents.workspaceId,
              },
            ),
            inArray(documents.id, ids),
            isNull(documents.parentId),
          ),
        );
    }
  };

  restore = async (ids: string[]): Promise<DocumentItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .update(documents)
      .set(restoreStamp())
      .where(and(this.ownership(true), inArray(documents.id, ids), isTrashed(documents.isDeleted)))
      .returning();
  };

  purge = async (ids: string[]) => {
    if (ids.length === 0) return [];
    return this.db
      .delete(documents)
      .where(and(this.ownership(true), inArray(documents.id, ids), isTrashed(documents.isDeleted)))
      .returning({ id: documents.id });
  };

  findByFileId = async (fileId: string) => {
    return this.db.query.documents.findFirst({
      // A file can legitimately own more than one document: `parseDocument`
      // writes a page-editor copy next to the parse cache `parseFile` writes.
      // Pick the oldest one explicitly instead of leaving the choice to the
      // query plan, so repeated lookups keep returning the same content.
      // `created_at` carries no uniqueness guarantee, so `id` breaks ties.
      orderBy: [asc(documents.createdAt), asc(documents.id)],
      where: and(this.ownership(), eq(documents.fileId, fileId)),
    });
  };

  findBySlug = async (slug: string): Promise<DocumentItem | undefined> => {
    return this.db.query.documents.findFirst({
      where: and(this.ownership(), eq(documents.slug, slug)),
    });
  };

  /**
   * Look up the user's existing document for a given `(source, sourceType)` pair.
   *
   * Crawl-style ingestion flows (`sourceType: 'web'`) use this to dedupe by URL
   * so repeated crawls of the same page update the existing row instead of
   * appending a fresh one — see .
   */
  findBySource = async (
    source: string,
    sourceType: NonNullable<NewDocument['sourceType']>,
  ): Promise<DocumentItem | undefined> => {
    return this.db.query.documents.findFirst({
      where: and(
        this.ownership(),
        eq(documents.source, source),
        eq(documents.sourceType, sourceType),
      ),
    });
  };

  update = async (id: string, value: Partial<DocumentItem>, trx?: Transaction) => {
    // visibility is intentionally not updatable via this path. The only legal
    // transition is `private → public` via `publishToWorkspace`; strip any
    // incoming value so callers can't sneak around the one-way rule.
    const { visibility: _ignored, ...patch } = value;

    const update = async (db: LobeChatDatabase) => {
      if (value.parentId !== undefined) {
        await lockDocumentHierarchy(db, this.userId, this.workspaceId);
        const scopedModel = new DocumentModel(
          db,
          this.userId,
          this.workspaceId,
          this.callerAgentVisibility,
        );
        const current = await scopedModel.findById(id);
        if (!current) throw new Error('Document not found');
        if (value.parentId) {
          const parent = await db.query.documents.findFirst({
            where: and(eq(documents.id, value.parentId), notTrashed(documents.isDeleted)),
          });
          if (!parent) throw new Error(DOCUMENT_PARENT_NOT_FOUND);
        }
      }

      return db
        .update(documents)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(this.ownership(), eq(documents.id, id)));
    };

    if (trx) return update(trx as unknown as LobeChatDatabase);
    if (value.parentId === undefined) return update(this.db);
    return this.db.transaction((tx) => update(tx as unknown as LobeChatDatabase));
  };

  /**
   * Publish one private document into the workspace. Convenience wrapper
   * around `setVisibility(rootId, 'public')`; kept as a named method for the
   * TRPC `publishDocumentToWorkspace` procedure and existing callers.
   *
   * @returns the id of the document that was re-published.
   */
  publishToWorkspace = async (rootId: string): Promise<{ documentIds: string[] }> => {
    return this.setVisibility(rootId, 'public');
  };

  /**
   * Flip one document's `visibility`. Documents do not inherit ACL or
   * visibility from their parent: a parent may be used purely for navigation.
   */
  setVisibility = async (
    rootId: string,
    visibility: 'private' | 'public',
  ): Promise<{ documentIds: string[] }> => {
    return this.db.transaction(async (trx) => {
      const result = await (trx as LobeChatDatabase)
        .update(documents)
        .set({ updatedAt: new Date(), visibility })
        .where(and(eq(documents.id, rootId), this.ownership(), eq(documents.userId, this.userId)))
        .returning({ id: documents.id });

      if (result.length === 0) throw new Error('Document not found');

      // Mirror visibility onto existing Work projections in the same
      // transaction. Scope without works.visibility so a promotion can
      // update rows that are currently private.
      await (trx as LobeChatDatabase)
        .update(works)
        .set({ visibility })
        .where(
          and(
            eq(works.resourceType, 'document'),
            eq(works.resourceId, rootId),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              { isDeleted: works.isDeleted, userId: works.userId, workspaceId: works.workspaceId },
            ),
          ),
        );

      return { documentIds: [rootId] };
    });
  };

  /**
   * Collect a document and all its descendants (folders + leaves) via BFS.
   * Honors the current ownership scope.
   */
  collectSubtree = async (
    rootId: string,
    runner: LobeChatDatabase = this.db,
  ): Promise<DocumentItem[]> => {
    return this.collectSubtrees([rootId], runner);
  };

  /** Collect several document trees with one query per depth, not per root. */
  collectSubtrees = async (
    rootIds: string[],
    runner: LobeChatDatabase = this.db,
  ): Promise<DocumentItem[]> => {
    const uniqueRootIds = [...new Set(rootIds)];
    if (uniqueRootIds.length === 0) return [];

    const roots = await runner.query.documents.findMany({
      where: and(this.ownership(), inArray(documents.id, uniqueRootIds)),
    });
    if (roots.length === 0) return [];

    const collected = new Map(roots.map((root) => [root.id, root]));
    let frontier = roots.map((root) => root.id);

    while (frontier.length > 0) {
      const children = await runner.query.documents.findMany({
        where: and(this.ownership(), inArray(documents.parentId, frontier)),
      });
      const unseen = children.filter((child) => !collected.has(child.id));
      if (unseen.length === 0) break;
      for (const child of unseen) collected.set(child.id, child);
      frontier = unseen.map((child) => child.id);
    }

    return [...collected.values()];
  };

  countFileUsageInSubtree = async (
    rootId: string,
    runner: LobeChatDatabase = this.db,
  ): Promise<number> => {
    const subtree = await this.collectSubtree(rootId, runner);
    if (subtree.length === 0) return 0;

    const ids = subtree.map((d) => d.id);
    const result = await runner
      .select({ totalSize: sum(files.size) })
      .from(files)
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
          inArray(files.parentId, ids),
        ),
      );

    return parseInt(result[0]?.totalSize ?? '0') || 0;
  };

  /**
   * Transfer a document (and its subtree) to another workspace / personal scope.
   * Files anchored to documents in the subtree are also re-homed so the
   * resource manager view stays consistent.
   */
  /**
   * Whether the subtree (documents + anchored files + comments + likes)
   * contains rows created by someone else. Transfers rehome every cascaded row, so non-owner
   * members must not move a folder that carries teammates' content. Comments
   * with a deleted author count as foreign because they do not belong to the
   * caller and may otherwise be moved or deleted by a personal-scope transfer.
   */
  subtreeHasForeignRows = async (documentId: string): Promise<boolean> => {
    const subtree = await this.collectSubtree(documentId, this.db);
    return this.hasForeignRows(subtree, this.db);
  };

  /**
   * Shared predicate behind {@link subtreeHasForeignRows} and the in-transaction
   * recheck of {@link transferTo}: the router's preflight alone is a TOCTOU —
   * a teammate's comment/like committed between the preflight and the transfer
   * transaction would otherwise be rehomed or deleted past the owner-only guard.
   */
  private hasForeignRows = async (
    subtree: { id: string; userId: string }[],
    runner: LobeChatDatabase,
  ): Promise<boolean> => {
    if (subtree.some((doc) => doc.userId !== this.userId)) return true;

    const ids = subtree.map((doc) => doc.id);
    if (ids.length === 0) return false;

    const [foreignComment] = await runner
      .select({ id: documentComments.id })
      .from(documentComments)
      .where(
        and(
          inArray(documentComments.documentId, ids),
          or(ne(documentComments.authorUserId, this.userId), isNull(documentComments.authorUserId)),
        ),
      )
      .limit(1);
    if (foreignComment) return true;

    const [foreignLike] = await runner
      .select({ id: documentLikes.id })
      .from(documentLikes)
      .where(and(inArray(documentLikes.documentId, ids), ne(documentLikes.userId, this.userId)))
      .limit(1);
    if (foreignLike) return true;

    const [foreignFile] = await runner
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.parentId, ids), ne(files.userId, this.userId)))
      .limit(1);
    return !!foreignFile;
  };

  transferTo = async (
    documentId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
    options?: {
      /**
       * Re-assert inside the transaction that the subtree carries no rows
       * created by someone else (non-owner transfers). Throws
       * {@link DOCUMENT_TRANSFER_FOREIGN_ROWS} when violated.
       */
      forbidForeignRows?: boolean;
    },
  ): Promise<{ documentIds: string[] }> => {
    return this.db.transaction(async (trx) => {
      await lockDocumentHierarchy(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const scopedTrx = new DocumentModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scopedTrx.collectSubtree(documentId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Document not found');

      const ids = subtree.map((d) => d.id);

      // Lock every subtree document row first: concurrent comment/like writers
      // take FOR UPDATE on the document row before stamping a workspace, so
      // they either commit before this point (and are seen by the recheck
      // below) or block until this transfer commits and then re-validate.
      await (trx as LobeChatDatabase)
        .select({ id: documents.id })
        .from(documents)
        .where(inArray(documents.id, ids))
        .for('update');

      if (
        options?.forbidForeignRows &&
        (await scopedTrx.hasForeignRows(subtree, trx as LobeChatDatabase))
      ) {
        throw new Error(DOCUMENT_TRANSFER_FOREIGN_ROWS);
      }
      const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };
      // Visibility only applies when landing in a workspace — personal scope
      // treats every row as implicitly private. Transfer still moves the
      // selected tree as one operation, while ordinary visibility changes do not cascade.
      const visibilityUpdate =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

      // Resolve slug conflicts in the target scope
      for (const doc of subtree) {
        if (!doc.slug) continue;
        const slug = await this.findAvailableSlug(
          trx as LobeChatDatabase,
          doc.slug,
          targetWorkspaceId,
          targetUserId,
          doc.id,
        );
        if (slug !== doc.slug) {
          await (trx as LobeChatDatabase)
            .update(documents)
            .set({ slug })
            .where(eq(documents.id, doc.id));
        }
      }

      await (trx as LobeChatDatabase)
        .update(documents)
        .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: new Date() })
        .where(inArray(documents.id, ids));

      if (targetWorkspaceId) {
        await (trx as LobeChatDatabase)
          .update(documentComments)
          // A scope transfer is not an author edit. Preserve updatedAt to bypass
          // the schema's Drizzle $onUpdate hook.
          .set({ updatedAt: documentComments.updatedAt, workspaceId: targetWorkspaceId })
          .where(inArray(documentComments.documentId, ids));

        await (trx as LobeChatDatabase)
          .update(documentCommentMentions)
          .set({ workspaceId: targetWorkspaceId })
          .where(
            inArray(
              documentCommentMentions.commentId,
              (trx as LobeChatDatabase)
                .select({ id: documentComments.id })
                .from(documentComments)
                .where(inArray(documentComments.documentId, ids)),
            ),
          );

        await (trx as LobeChatDatabase)
          .update(documentLikes)
          .set({ workspaceId: targetWorkspaceId })
          .where(inArray(documentLikes.documentId, ids));
      } else {
        // Comments are Workspace assets and cannot follow a document into personal scope.
        // Mention rows are removed by the comment FK cascade.
        await (trx as LobeChatDatabase)
          .delete(documentComments)
          .where(inArray(documentComments.documentId, ids));

        // Likes are Workspace reactions too; a personal document has no like surface.
        await (trx as LobeChatDatabase)
          .delete(documentLikes)
          .where(inArray(documentLikes.documentId, ids));
      }

      // Move files anchored to these documents; their visibility mirrors the
      // document subtree in workspace scope.
      await (trx as LobeChatDatabase)
        .update(files)
        .set({ ...ownershipUpdate, ...visibilityUpdate })
        .where(inArray(files.parentId, ids));

      return { documentIds: ids };
    });
  };

  /**
   * Deep clone a document (and its subtree) into another workspace / personal
   * scope. Generates fresh ids and preserves the parent/child topology.
   */
  copyToWorkspace = async (
    documentId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ rootId: string }> => {
    return this.db.transaction(async (trx) => {
      await lockDocumentHierarchy(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const scopedTrx = new DocumentModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scopedTrx.collectSubtree(documentId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Document not found');

      // Visibility only applies when landing in a workspace.
      const visibilityOverride =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

      // BFS clone: parents are inserted before children so we always know the
      // new parent id by the time we get to the child.
      const idMap = new Map<string, string>();
      const byId = new Map(subtree.map((d) => [d.id, d]));
      const queue: string[] = [documentId];
      const seen = new Set<string>();

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (seen.has(currentId)) continue;
        seen.add(currentId);
        const original = byId.get(currentId);
        if (!original) continue;

        const newParentId =
          currentId === documentId ? null : (idMap.get(original.parentId!) ?? null);

        let newSlug = original.slug;
        if (newSlug) {
          newSlug = await this.findAvailableSlug(
            trx as LobeChatDatabase,
            newSlug,
            targetWorkspaceId,
            targetUserId,
          );
        }

        const inserted = (await (trx as LobeChatDatabase)
          .insert(documents)
          .values({
            accessedAt: original.accessedAt,
            clientId: null,
            content: original.content,
            editorData: original.editorData,
            fileId: null,
            fileType: original.fileType,
            filename: original.filename,
            knowledgeBaseId: null,
            metadata: { ...original.metadata, duplicatedFrom: original.id },
            pages: original.pages,
            parentId: newParentId,
            slug: newSlug,
            source: original.source,
            sourceType: original.sourceType,
            title: original.title,
            totalCharCount: original.totalCharCount,
            totalLineCount: original.totalLineCount,
            userId: targetUserId,
            workspaceId: targetWorkspaceId,
            ...visibilityOverride,
          } as NewDocument)
          .returning({ id: documents.id })) as { id: string }[];

        idMap.set(original.id, inserted[0]!.id);

        for (const c of subtree) {
          if (c.parentId === original.id) queue.push(c.id);
        }
      }

      return { rootId: idMap.get(documentId)! };
    });
  };

  /**
   * Find a slug not already taken in the target (workspaceId, userId) scope.
   * Tries `slug`, `slug-1`, …, `slug-99`. Mirrors the agent transfer behavior.
   */
  private findAvailableSlug = async (
    runner: LobeChatDatabase,
    baseSlug: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    ignoreDocumentId?: string,
  ): Promise<string> => {
    const buildWhere = (candidate: string) =>
      targetWorkspaceId
        ? and(eq(documents.slug, candidate), eq(documents.workspaceId, targetWorkspaceId))
        : and(
            eq(documents.slug, candidate),
            eq(documents.userId, targetUserId),
            isNull(documents.workspaceId),
          );

    const isFree = async (candidate: string): Promise<boolean> => {
      const existing = await runner.query.documents.findFirst({ where: buildWhere(candidate) });
      if (!existing) return true;
      return ignoreDocumentId !== undefined && existing.id === ignoreDocumentId;
    };

    if (await isFree(baseSlug)) return baseSlug;

    for (let suffix = 1; suffix < 100; suffix++) {
      const candidate = `${baseSlug}-${suffix}`;
      if (await isFree(candidate)) return candidate;
    }
    // Fallback: append timestamp to guarantee uniqueness
    return `${baseSlug}-${Date.now()}`;
  };
}
