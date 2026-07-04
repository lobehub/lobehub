import { and, count, desc, eq, inArray, isNull, notInArray, sum } from 'drizzle-orm';

import type { DocumentItem, NewDocument } from '../schemas';
import { DOCUMENT_FOLDER_TYPE, documents, files } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface QueryDocumentParams {
  current?: number;
  fileTypes?: string[];
  pageSize?: number;
  sourceTypes?: string[];
}

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

  private ownership = () =>
    buildWorkspaceWhere(
      {
        callerAgentVisibility: this.callerAgentVisibility,
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

  create = async (params: Omit<NewDocument, 'userId'>): Promise<DocumentItem> => {
    // Workspace-mode default for visibility:
    //   - explicit visibility wins
    //   - else if parentId set: inherit parent's visibility (tree invariant —
    //     a child must never have a visibility different from its root)
    //   - else top-level user-authored Pages (`sourceType: 'api'`): default to
    //     `'private'` so workspace members start drafts in their own space and
    //     publish when ready
    //   - all other top-level rows (web crawls, file ingests, topic snapshots,
    //     agent-signal artifacts, …): leave the schema default (`'public'`) so
    //     existing behavior is preserved — these don't have a Pages-style
    //     draft / publish lifecycle and were workspace-shared from day one
    // Personal mode leaves it to the schema default; the filter ignores it.
    let visibility = params.visibility;
    if (!visibility && this.workspaceId) {
      if (params.parentId) {
        const parent = await this.findById(params.parentId);
        visibility = parent?.visibility ?? 'private';
      } else if (params.sourceType === 'api') {
        visibility = 'private';
      }
    }

    const result = (await this.db
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

  delete = async (id: string) => {
    return this.db.delete(documents).where(and(eq(documents.id, id), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(documents).where(this.ownership());
  };

  query = async ({
    current = 0,
    pageSize = 9999,
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

  findByFileId = async (fileId: string) => {
    return this.db.query.documents.findFirst({
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

  update = async (id: string, value: Partial<DocumentItem>) => {
    // visibility is intentionally not updatable via this path. The only legal
    // transition is `private → public` via `publishToWorkspace`; strip any
    // incoming value so callers can't sneak around the one-way rule.
    const { visibility: _ignored, ...patch } = value;

    // Workspace-mode parent-id guard: a tree's whole subtree shares one
    // visibility (P1 strong consistency), so moving a node under a parent with
    // a different visibility would create a mixed subtree. Refuse the move and
    // point the caller at the proper one-way publish path when relevant.
    if (this.workspaceId && patch.parentId !== undefined) {
      const current = await this.findById(id);
      if (current && patch.parentId !== null) {
        const parent = await this.findById(patch.parentId);
        if (parent && parent.visibility !== current.visibility) {
          throw new Error(
            current.visibility === 'private'
              ? 'Cannot move a private document under a workspace document; use publishToWorkspace instead.'
              : 'Cannot move a workspace document under a private document; demoting to private is not allowed.',
          );
        }
      }
    }

    return this.db
      .update(documents)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(this.ownership(), eq(documents.id, id)));
  };

  /**
   * Publish a private document subtree into the workspace. **One-way only** —
   * once published, other members may already depend on referenced pages, so
   * we never let it slip back to `private`. The `eq(user_id)` +
   * `eq(visibility, 'private')` guards keep the operation creator-only and
   * idempotent against already-public rows.
   *
   * Cascades over the whole subtree (rooted at `rootId`) so a folder Page and
   * every nested child flip in one transaction.
   *
   * @returns the ids of the documents that were re-published.
   */
  publishToWorkspace = async (rootId: string): Promise<{ documentIds: string[] }> => {
    return this.db.transaction(async (trx) => {
      const scopedTrx = new DocumentModel(
        trx as LobeChatDatabase,
        this.userId,
        this.workspaceId,
        this.callerAgentVisibility,
      );
      const subtree = await scopedTrx.collectSubtree(rootId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Document not found');

      const ids = subtree.map((d) => d.id);

      await (trx as LobeChatDatabase)
        .update(documents)
        .set({ updatedAt: new Date(), visibility: 'public' })
        .where(
          and(
            inArray(documents.id, ids),
            eq(documents.userId, this.userId),
            eq(documents.visibility, 'private'),
          ),
        );

      // No child-table cascade needed here — Pages (`sourceType: 'api'`) hold
      // content inline in `documents.content` / `documents.pages`, and the
      // `document_chunks` junction has no read consumers on the RAG hot path
      // (that lane goes through `chunks` + `fileChunks` + `files`).
      // A future `document_chunks` visibility mirror + RAG filter will add
      // cascade when that lane is built.

      return { documentIds: ids };
    });
  };

  /**
   * Collect a document and all its descendants (folders + leaves) via BFS.
   * Honors the current ownership scope.
   */
  private collectSubtree = async (
    rootId: string,
    runner: LobeChatDatabase = this.db,
  ): Promise<DocumentItem[]> => {
    const root = await runner.query.documents.findFirst({
      where: and(this.ownership(), eq(documents.id, rootId)),
    });
    if (!root) return [];

    const collected: DocumentItem[] = [root];
    let frontier: string[] = [root.id];

    while (frontier.length > 0) {
      const children = await runner.query.documents.findMany({
        where: and(this.ownership(), inArray(documents.parentId, frontier)),
      });
      if (children.length === 0) break;
      collected.push(...children);
      frontier = children.map((c) => c.id);
    }

    return collected;
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
  transferTo = async (
    documentId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<{ documentIds: string[] }> => {
    return this.db.transaction(async (trx) => {
      const scopedTrx = new DocumentModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scopedTrx.collectSubtree(documentId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Document not found');

      const ids = subtree.map((d) => d.id);
      const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };

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
        .set({ ...ownershipUpdate, updatedAt: new Date() })
        .where(inArray(documents.id, ids));

      // Move files anchored to these documents
      await (trx as LobeChatDatabase)
        .update(files)
        .set(ownershipUpdate)
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
  ): Promise<{ rootId: string }> => {
    return this.db.transaction(async (trx) => {
      const scopedTrx = new DocumentModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scopedTrx.collectSubtree(documentId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Document not found');

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
