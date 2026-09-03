import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { DocumentItem, FileItem, TrashDetachedEdge } from '@/database/schemas';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import type { TrashHandlerContext } from './types';

interface ResourceClosureInput {
  documentIds?: string[];
  fileIds?: string[];
}

interface ResourceClosureResult {
  detachedEdges: TrashDetachedEdge[];
  documents: DocumentItem[];
  files: FileItem[];
}

/**
 * Trash the complete document/file relation closure for one registry root.
 *
 * A document subtree can own anchored files; a file can be mirrored by more
 * than one document; and those mirrors can own their own subtrees and files.
 * Walking until neither side produces new rows gives restore and purge the
 * same complete, durable registry instead of leaving live orphans behind.
 */
export const softDeleteResourceClosure = async (
  ctx: TrashHandlerContext,
  input: ResourceClosureInput,
  options: SoftDeleteOptions,
): Promise<ResourceClosureResult> => {
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
    const documentRoots = [...pendingDocumentRoots];
    pendingDocumentRoots.clear();

    for (const rootId of documentRoots) {
      if (processedDocumentRoots.has(rootId) || documentsById.has(rootId)) continue;
      processedDocumentRoots.add(rootId);

      const { detachedEdges, documents } = await documentModel.softDeleteSubtree(rootId, options);
      if (documents.length === 0) continue;

      for (const document of documents) documentsById.set(document.id, document);
      for (const edge of detachedEdges)
        detachedEdgesById.set(`${edge.resourceType}:${edge.resourceId}`, edge);

      const documentIds = documents.map((document) => document.id);
      const anchoredFiles = await fileModel.findByParentIds(documentIds);
      const detachedFileEdges = await fileModel.detachPrivateChildren(documentIds);
      for (const edge of detachedFileEdges)
        detachedEdgesById.set(`${edge.resourceType}:${edge.resourceId}`, edge);

      for (const file of anchoredFiles) pendingFiles.add(file.id);
      for (const document of documents) {
        if (document.fileId) pendingFiles.add(document.fileId);
      }
    }

    const fileIds = [...pendingFiles].filter((id) => !processedFiles.has(id));
    pendingFiles.clear();
    if (fileIds.length === 0) continue;
    for (const id of fileIds) processedFiles.add(id);

    const files = await fileModel.softDelete(fileIds, options);
    for (const file of files) filesById.set(file.id, file);

    const mirrorDocuments = await documentModel.findByFileIds(files.map((file) => file.id));
    for (const document of mirrorDocuments) {
      if (!documentsById.has(document.id)) pendingDocumentRoots.add(document.id);
    }
  }

  return {
    detachedEdges: [...detachedEdgesById.values()],
    documents: [...documentsById.values()],
    files: [...filesById.values()],
  };
};
