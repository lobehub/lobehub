import { FileSource } from '@lobechat/types';
import pMap from 'p-map';

import type { AgentDocumentVfsDeps } from './deps';
import { AgentDocumentVfsError } from './errors';
import { toOrdinaryStats } from './nodes';
import {
  buildOrdinaryPathFromNode,
  collectDeletedAncestors,
  collectOrdinarySubtree,
  resolveOrdinaryPath,
} from './ordinaryTree';
import { normalizeAgentDocumentPath } from './paths';
import type { AgentDocumentStats, AgentDocumentTrashEntry, AgentDocumentVfsContext } from './types';

/**
 * Lists agent-scoped trash entries.
 *
 * Use when:
 * - CLI `trash ls` needs a recovery-oriented view
 *
 * Returns:
 * - Flat trash entries with reconstructed paths
 */
export async function listTrash(
  deps: AgentDocumentVfsDeps,
  ctx: AgentDocumentVfsContext,
  path?: string,
): Promise<AgentDocumentTrashEntry[]> {
  const deletedDocs = await deps.agentDocumentModel.listDeletedByAgent(ctx.agentId);
  // Each path reconstruction issues DB reads; cap the fan-out per agent trash size.
  const entries = await pMap(
    deletedDocs,
    async (doc) => {
      const path = await buildOrdinaryPathFromNode(deps, doc, ctx.agentId);
      return {
        ...toOrdinaryStats(doc, path),
        deleteReason: doc.deleteReason,
        deletedAt: doc.deletedAt ?? new Date(0),
      } satisfies AgentDocumentTrashEntry;
    },
    { concurrency: 10 },
  );

  if (!path) return entries;

  const normalizedPath = normalizeAgentDocumentPath(path);
  return entries.filter(
    (entry) => entry.path === normalizedPath || entry.path.startsWith(`${normalizedPath}/`),
  );
}

/**
 * Restores a trash entry back into the live VFS tree.
 *
 * Use when:
 * - CLI `trash restore` needs to reactivate a soft-deleted path
 *
 * Returns:
 * - The restored node state
 */
export async function restoreFromTrash(
  deps: AgentDocumentVfsDeps,
  agentDocumentId: string,
  ctx: AgentDocumentVfsContext,
): Promise<AgentDocumentStats> {
  const root = await deps.agentDocumentModel.findByIdWithOptions(agentDocumentId, {
    includeDeleted: true,
  });

  if (!root?.deletedAt) {
    throw new AgentDocumentVfsError(`Trash entry not found: ${agentDocumentId}`, 'NOT_FOUND');
  }

  const ancestors = await collectDeletedAncestors(deps, root, ctx.agentId);
  const subtree = await collectOrdinarySubtree(deps, root, ctx.agentId, true);

  for (const ancestor of ancestors.reverse()) {
    if (ancestor.deletedAt) {
      await deps.agentDocumentModel.restore(ancestor.id);
    }
  }

  for (const item of subtree) {
    if (item.deletedAt) {
      await deps.agentDocumentModel.restore(item.id);
    }
  }

  const restored = await resolveOrdinaryPath(
    deps,
    await buildOrdinaryPathFromNode(deps, root, ctx.agentId),
    ctx.agentId,
  );

  if (!restored) {
    throw new AgentDocumentVfsError(`Failed to restore path: ${agentDocumentId}`, 'BAD_REQUEST');
  }

  return toOrdinaryStats(restored, await buildOrdinaryPathFromNode(deps, restored, ctx.agentId));
}

/**
 * Permanently removes a trash entry and its subtree.
 *
 * Use when:
 * - CLI `trash rm` should erase recoverable state
 *
 * Returns:
 * - Void
 */
export async function deletePermanently(
  deps: AgentDocumentVfsDeps,
  agentDocumentId: string,
  ctx: AgentDocumentVfsContext,
): Promise<void> {
  const root = await deps.agentDocumentModel.findByIdWithOptions(agentDocumentId, {
    includeDeleted: true,
  });

  if (!root?.deletedAt) {
    throw new AgentDocumentVfsError(`Trash entry not found: ${agentDocumentId}`, 'NOT_FOUND');
  }

  const subtree = await collectOrdinarySubtree(deps, root, ctx.agentId, true);

  for (const item of subtree.reverse()) {
    const fileIds = await deps.agentDocumentModel.permanentlyDelete(item.id);
    for (const fileId of fileIds) {
      await deps.getFileService().removeUnreferencedFile(fileId, FileSource.AgentDocument);
    }
  }
}

export async function restoreFromTrashByPath(
  deps: AgentDocumentVfsDeps,
  path: string,
  ctx: AgentDocumentVfsContext,
): Promise<AgentDocumentStats> {
  const entry = await findTrashEntryByPath(deps, path, ctx);

  if (!entry) {
    throw new AgentDocumentVfsError(`Trash entry not found: ${path}`, 'NOT_FOUND');
  }

  return restoreFromTrash(deps, entry.agentDocumentId!, ctx);
}

export async function deletePermanentlyByPath(
  deps: AgentDocumentVfsDeps,
  path: string,
  ctx: AgentDocumentVfsContext,
): Promise<void> {
  const entry = await findTrashEntryByPath(deps, path, ctx);

  if (!entry) {
    throw new AgentDocumentVfsError(`Trash entry not found: ${path}`, 'NOT_FOUND');
  }

  await deletePermanently(deps, entry.agentDocumentId!, ctx);
}

export async function findTrashEntryByPath(
  deps: AgentDocumentVfsDeps,
  path: string,
  ctx: AgentDocumentVfsContext,
) {
  const normalizedPath = normalizeAgentDocumentPath(path);
  const entries = await listTrash(deps, ctx);
  return entries.find((entry) => entry.path === normalizedPath);
}
