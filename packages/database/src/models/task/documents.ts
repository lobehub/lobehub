import type { WorkspaceData, WorkspaceDocNode, WorkspaceTreeNode } from '@lobechat/types';
import { and, eq, gte, sql } from 'drizzle-orm';

import { documents } from '../../schemas/file';
import { taskDocuments } from '../../schemas/task';
import { buildWorkspaceWhere } from '../../utils/workspace';
import {
  docsOwnership,
  getTaskVisibility,
  type TaskModelContext,
  taskOwnershipSql,
} from './context';

export const pinDocument = async (
  ctx: TaskModelContext,
  taskId: string,
  documentId: string,
  pinnedBy: string = 'agent',
): Promise<void> => {
  const visibility = await getTaskVisibility(ctx, taskId);
  await ctx.db
    .insert(taskDocuments)
    .values({
      documentId,
      pinnedBy,
      taskId,
      userId: ctx.userId,
      visibility,
      workspaceId: ctx.workspaceId ?? null,
    })
    .onConflictDoNothing();
};

export const unpinDocument = async (
  ctx: TaskModelContext,
  taskId: string,
  documentId: string,
): Promise<void> => {
  await ctx.db
    .delete(taskDocuments)
    .where(
      and(
        eq(taskDocuments.taskId, taskId),
        eq(taskDocuments.documentId, documentId),
        docsOwnership(ctx),
      ),
    );
};

export const getPinnedDocuments = async (ctx: TaskModelContext, taskId: string) => {
  return ctx.db
    .select()
    .from(taskDocuments)
    .where(and(eq(taskDocuments.taskId, taskId), docsOwnership(ctx)))
    .orderBy(taskDocuments.createdAt);
};

/**
 * Documents pinned to a task at or after a given timestamp, joined with the
 * `documents` table so callers receive `{ id, kind, title }` directly.
 *
 * Used by topic-brief synthesis to attribute artifacts to the topic that
 * just completed: pass the topic's start time as `since`.
 */
export const getDocumentsPinnedSince = async (
  ctx: TaskModelContext,
  taskId: string,
  since: Date,
): Promise<{ id: string; kind: string | null; title: string | null }[]> => {
  const rows = await ctx.db
    .select({
      fileType: documents.fileType,
      id: documents.id,
      title: documents.title,
    })
    .from(taskDocuments)
    // Guard the referenced document too: the junction's visibility column is
    // a write-time mirror of the TASK, so a document independently switched
    // back to private would otherwise still leak its title here.
    .innerJoin(
      documents,
      and(
        eq(taskDocuments.documentId, documents.id),
        buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, documents),
      ),
    )
    .where(
      and(
        eq(taskDocuments.taskId, taskId),
        docsOwnership(ctx),
        gte(taskDocuments.createdAt, since),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    /* v8 ignore next -- unreachable: documents.file_type is NOT NULL and the inner join always yields a document row */
    kind: row.fileType ?? null,
    title: row.title ?? null,
  }));
};

// Get all pinned docs from a task tree (recursive), returns nodeMap + tree structure
export const getTreePinnedDocuments = async (
  ctx: TaskModelContext,
  rootTaskId: string,
): Promise<WorkspaceData> => {
  const rootOwnership = taskOwnershipSql(ctx);
  const recursiveOwnership = taskOwnershipSql(ctx, 't');
  const docsOwnership = ctx.workspaceId
    ? sql`td.workspace_id = ${ctx.workspaceId}
          AND (td.visibility = 'public' OR td.user_id = ${ctx.userId})`
    : sql`td.user_id = ${ctx.userId} AND td.workspace_id IS NULL`;
  // Guard the referenced document row itself: `td.visibility` is a
  // write-time mirror of the TASK's visibility, so a document independently
  // switched back to private would otherwise still leak its title/metadata
  // through this join. A guarded-out document keeps its junction row but
  // joins as NULL → surfaced as an inaccessible tombstone node.
  const documentVisibility = ctx.workspaceId
    ? sql`d.workspace_id = ${ctx.workspaceId}
          AND (d.visibility IS NULL OR d.visibility = 'public' OR d.user_id = ${ctx.userId})`
    : sql`d.user_id = ${ctx.userId} AND d.workspace_id IS NULL`;
  const result = await ctx.db.execute(sql`
    WITH RECURSIVE task_tree AS (
      SELECT id, identifier FROM tasks WHERE id = ${rootTaskId} AND ${rootOwnership}
      UNION ALL
      SELECT t.id, t.identifier FROM tasks t
      JOIN task_tree tt ON t.parent_task_id = tt.id
      WHERE ${recursiveOwnership}
    )
    SELECT td.*, tt.id as source_task_id, tt.identifier as source_task_identifier,
           d.id as document_ref_id,
           d.title as document_title, d.file_type as document_file_type, d.parent_id as document_parent_id,
           d.total_char_count as document_char_count, d.updated_at as document_updated_at
    FROM task_documents td
    JOIN task_tree tt ON td.task_id = tt.id
    LEFT JOIN documents d ON td.document_id = d.id AND ${documentVisibility}
    WHERE ${docsOwnership}
    ORDER BY td.created_at
  `);

  // Build nodeMap
  const nodeMap: Record<string, WorkspaceDocNode> = {};

  const docIds = new Set<string>();

  for (const row of result.rows as any[]) {
    const docId = row.document_id;
    // Join miss = the viewer lost access to the document (switched back to
    // private) or it was deleted. Emit a titleless tombstone so the UI can
    // render a no-access placeholder instead of leaking the title.
    const inaccessible = row.document_ref_id === null;
    docIds.add(docId);
    nodeMap[docId] = {
      charCount: inaccessible ? null : row.document_char_count,
      createdAt: row.created_at,
      fileType: inaccessible ? '' : row.document_file_type,
      inaccessible: inaccessible || undefined,
      parentId: inaccessible ? null : row.document_parent_id,
      pinnedBy: row.pinned_by,
      sourceTaskId: row.source_task_id,
      sourceTaskIdentifier: row.source_task_id !== rootTaskId ? row.source_task_identifier : null,
      title: inaccessible ? '' : row.document_title || 'Untitled',
      updatedAt: inaccessible ? null : row.document_updated_at,
    };
  }

  // Build tree (children as id references)
  type TreeNode = WorkspaceTreeNode;

  const childrenMap = new Map<string | null, TreeNode[]>();
  for (const docId of docIds) {
    const node = nodeMap[docId];
    const parentId = node.parentId && docIds.has(node.parentId) ? node.parentId : null;
    const list = childrenMap.get(parentId) || [];
    list.push({ children: [], id: docId });
    childrenMap.set(parentId, list);
  }

  const buildTree = (parentId: string | null): TreeNode[] => {
    const nodes = childrenMap.get(parentId) || [];
    for (const node of nodes) {
      node.children = buildTree(node.id);
    }
    return nodes;
  };

  return { nodeMap, tree: buildTree(null) };
};
