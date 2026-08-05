import { and, count, desc, eq, inArray, isNull, ne, notInArray, sum } from 'drizzle-orm';

import type { DocumentItem, NewDocument } from '../schemas';
import { DOCUMENT_FOLDER_TYPE, documents, files, works } from '../schemas';
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

  findByIds = async (ids: string[]): Promise<DocumentItem[]> => {
    if (ids.length === 0) return [];
    return this.db.query.documents.findMany({
      where: and(this.ownership(), inArray(documents.id, ids)),
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

    return this.db
      .update(documents)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(this.ownership(), eq(documents.id, id)));
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
              { userId: works.userId, workspaceId: works.workspaceId },
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
  /**
   * Whether the subtree (documents + anchored files) contains rows created by
   * someone else. Transfers rehome every cascaded row, so non-owner members
   * must not move a folder that carries teammates' content.
   */
  subtreeHasForeignRows = async (documentId: string): Promise<boolean> => {
    const subtree = await this.collectSubtree(documentId, this.db);
    if (subtree.some((doc) => doc.userId !== this.userId)) return true;

    const ids = subtree.map((doc) => doc.id);
    if (ids.length === 0) return false;

    const [foreignFile] = await this.db
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
  ): Promise<{ documentIds: string[] }> => {
    return this.db.transaction(async (trx) => {
      const scopedTrx = new DocumentModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scopedTrx.collectSubtree(documentId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Document not found');

      const ids = subtree.map((d) => d.id);
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
