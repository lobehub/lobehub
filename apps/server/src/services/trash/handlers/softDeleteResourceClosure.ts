import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { DocumentItem, FileItem, TrashDetachedEdge } from '@/database/schemas';
import {
  lockDocumentHierarchy,
  lockFileDocumentRelation,
} from '@/database/utils/documentHierarchy';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import type { TrashHandlerContext } from './types';

interface ResourceClosureInput {
  documentIds?: string[];
  fileIds?: string[];
}

export interface ResourceClosureResult {
  detachedEdges: TrashDetachedEdge[];
  documents: DocumentItem[];
  files: FileItem[];
  root: { id: string; type: 'document' | 'file' };
}

const resourceKey = (type: 'document' | 'file', id: string) => `${type}:${id}`;

const partitionClosure = (
  input: ResourceClosureInput,
  documents: DocumentItem[],
  files: FileItem[],
  detachedEdges: TrashDetachedEdge[],
): ResourceClosureResult[] => {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const filesById = new Map(files.map((file) => [file.id, file]));
  const adjacency = new Map<string, Set<string>>();
  for (const document of documents) adjacency.set(resourceKey('document', document.id), new Set());
  for (const file of files) adjacency.set(resourceKey('file', file.id), new Set());

  const connect = (left: string, right: string) => {
    if (!adjacency.has(left) || !adjacency.has(right)) return;
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  };
  for (const document of documents) {
    if (document.parentId) {
      connect(resourceKey('document', document.id), resourceKey('document', document.parentId));
    }
    if (document.fileId) {
      connect(resourceKey('document', document.id), resourceKey('file', document.fileId));
    }
  }
  for (const file of files) {
    if (file.parentId) {
      connect(resourceKey('file', file.id), resourceKey('document', file.parentId));
    }
  }

  const selectedRoots = [
    ...(input.documentIds ?? []).map((id) => ({ id, type: 'document' as const })),
    ...(input.fileIds ?? []).map((id) => ({ id, type: 'file' as const })),
  ].filter(
    (root, index, roots) =>
      roots.findIndex((candidate) => candidate.id === root.id && candidate.type === root.type) ===
      index,
  );
  const selectedOrder = new Map(
    selectedRoots.map((root, index) => [resourceKey(root.type, root.id), index]),
  );
  const selectedKeys = new Set(selectedOrder.keys());
  const visited = new Set<string>();
  const results: Array<ResourceClosureResult & { order: number }> = [];

  for (const selectedRoot of selectedRoots) {
    const selectedKey = resourceKey(selectedRoot.type, selectedRoot.id);
    if (!adjacency.has(selectedKey) || visited.has(selectedKey)) continue;

    const componentKeys = new Set<string>();
    const pending = [selectedKey];
    while (pending.length > 0) {
      const key = pending.pop()!;
      if (componentKeys.has(key)) continue;
      componentKeys.add(key);
      visited.add(key);
      for (const neighbour of adjacency.get(key) ?? []) pending.push(neighbour);
    }

    const candidates = selectedRoots.filter((root) =>
      componentKeys.has(resourceKey(root.type, root.id)),
    );
    const topLevelCandidates = candidates.filter((candidate) => {
      if (candidate.type !== 'document') return true;
      let parentId = documentsById.get(candidate.id)?.parentId;
      while (parentId) {
        if (selectedKeys.has(resourceKey('document', parentId))) return false;
        parentId = documentsById.get(parentId)?.parentId;
      }
      return true;
    });
    const root = (topLevelCandidates.length > 0 ? topLevelCandidates : candidates).reduce(
      (earliest, candidate) =>
        selectedOrder.get(resourceKey(candidate.type, candidate.id))! <
        selectedOrder.get(resourceKey(earliest.type, earliest.id))!
          ? candidate
          : earliest,
    );

    results.push({
      detachedEdges: detachedEdges.filter((edge) =>
        componentKeys.has(resourceKey('document', edge.originalParentId)),
      ),
      documents: [...componentKeys]
        .filter((key) => key.startsWith('document:'))
        .map((key) => documentsById.get(key.slice('document:'.length))!),
      files: [...componentKeys]
        .filter((key) => key.startsWith('file:'))
        .map((key) => filesById.get(key.slice('file:'.length))!),
      order: selectedOrder.get(resourceKey(root.type, root.id))!,
      root,
    });
  }

  return results
    .sort((left, right) => left.order - right.order)
    .map(({ order: _, ...result }) => result);
};

/**
 * Trash the complete document/file relation closure for one registry root.
 *
 * A document subtree can own anchored files; a file can be mirrored by more
 * than one document; and those mirrors can own their own subtrees and files.
 * Walking until neither side produces new rows gives restore and purge the
 * same complete, durable registry instead of leaving live orphans behind.
 */
export const softDeleteResourceClosures = async (
  ctx: TrashHandlerContext,
  input: ResourceClosureInput,
  options: SoftDeleteOptions,
): Promise<ResourceClosureResult[]> => {
  // Relation discovery spans multiple queries. Serialize closure walks within
  // one ownership scope, then use per-file locks shared with the parsers so a
  // mirror cannot be inserted after its file has been collected.
  await lockDocumentHierarchy(ctx.db, ctx.userId, ctx.workspaceId);

  const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
  const fileModel = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
  const documentsById = new Map<string, DocumentItem>();
  const filesById = new Map<string, FileItem>();
  const detachedEdgesById = new Map<string, TrashDetachedEdge>();
  const processedDocumentRoots = new Set<string>();
  const processedFiles = new Set<string>();
  const pendingDocumentRoots = new Set(input.documentIds ?? []);
  const pendingFiles = new Set(input.fileIds ?? []);

  while (pendingDocumentRoots.size > 0 || pendingFiles.size > 0) {
    const documentRoots = [...pendingDocumentRoots].filter(
      (id) => !processedDocumentRoots.has(id) && !documentsById.has(id),
    );
    pendingDocumentRoots.clear();

    if (documentRoots.length > 0) {
      for (const rootId of documentRoots) processedDocumentRoots.add(rootId);
      const result = await documentModel.softDeleteSubtrees(documentRoots, options);
      for (const document of result.documents) documentsById.set(document.id, document);
      for (const edge of result.detachedEdges) {
        detachedEdgesById.set(`${edge.resourceType}:${edge.resourceId}`, edge);
      }

      const documentIds = result.documents.map((document) => document.id);
      const anchoredFiles = await fileModel.findByParentIds(documentIds);
      const detachedFileEdges = await fileModel.detachPrivateChildren(documentIds);
      for (const edge of detachedFileEdges) {
        detachedEdgesById.set(`${edge.resourceType}:${edge.resourceId}`, edge);
      }

      for (const file of anchoredFiles) pendingFiles.add(file.id);
      for (const document of result.documents) {
        if (document.fileId) pendingFiles.add(document.fileId);
      }
    }

    const fileIds = [...pendingFiles].filter((id) => !processedFiles.has(id));
    pendingFiles.clear();
    if (fileIds.length === 0) continue;
    fileIds.sort();
    for (const fileId of fileIds) await lockFileDocumentRelation(ctx.db, fileId);
    for (const id of fileIds) processedFiles.add(id);

    const files = await fileModel.softDelete(fileIds, options);
    for (const file of files) filesById.set(file.id, file);

    const mirrorDocuments = await documentModel.findByFileIds(files.map((file) => file.id));
    for (const document of mirrorDocuments) {
      if (!documentsById.has(document.id)) pendingDocumentRoots.add(document.id);
    }
  }

  return partitionClosure(
    input,
    [...documentsById.values()],
    [...filesById.values()],
    [...detachedEdgesById.values()],
  );
};
