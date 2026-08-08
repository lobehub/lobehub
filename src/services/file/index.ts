import { CUSTOM_DOCUMENT_FILE_TYPE, DERIVED_DOCUMENT_SOURCE_TYPE } from '@lobechat/const';

import { lambdaClient } from '@/libs/trpc/client';
import {
  type CheckFileHashResult,
  type FileItem,
  type FileListItem,
  type KnowledgeItemStatus,
  type QueryFileListParams,
  type QueryFileListSchemaType,
  type UploadFileParams,
} from '@/types/files';

interface CreateFileParams extends Omit<UploadFileParams, 'url'> {
  knowledgeBaseId?: string;
  parentId?: string;
  url: string;
  visibility?: 'private' | 'public';
}

export class FileService {
  createFile = async (
    params: UploadFileParams & {
      parentId?: string;
      /**
       * Workspace visibility for the new file. `undefined` lets the server
       * apply its default (top-level workspace uploads default to `'private'`,
       * children inherit their parent document). Personal mode ignores this.
       */
      visibility?: 'private' | 'public';
    },
    knowledgeBaseId?: string,
  ): Promise<{ id: string; url: string }> => {
    return lambdaClient.file.createFile.mutate({ ...params, knowledgeBaseId } as CreateFileParams);
  };

  getFile = async (id: string): Promise<FileItem> => {
    const item = await lambdaClient.file.findById.query({ id });

    if (!item) {
      throw new Error('file not found');
    }

    return {
      createdAt: item.createdAt,
      id: item.id,
      name: item.name,
      size: item.size,
      source: item.source,
      type: item.fileType,
      updatedAt: item.updatedAt,
      url: item.url,
    };
  };

  removeFile = async (id: string): Promise<void> => {
    await lambdaClient.file.removeFile.mutate({ id });
  };

  removeFiles = async (ids: string[]): Promise<void> => {
    await lambdaClient.file.removeFiles.mutate({ ids });
  };

  // V2.0 Migrate from getFiles to getKnowledgeItems
  getKnowledgeItems = async (params: QueryFileListParams) => {
    return lambdaClient.file.getKnowledgeItems.query(params as QueryFileListSchemaType);
  };

  getKnowledgeItemStatusesByIds = async (ids: string[]): Promise<KnowledgeItemStatus[]> => {
    return lambdaClient.file.getKnowledgeItemStatusesByIds.query({ ids });
  };

  resolveKnowledgeItemIds = async (params: QueryFileListParams) => {
    return lambdaClient.file.resolveKnowledgeItemIds.query(params as QueryFileListSchemaType);
  };

  deleteKnowledgeItemsByQuery = async (
    params: QueryFileListParams & { excludedIds?: string[] },
  ) => {
    return lambdaClient.file.deleteKnowledgeItemsByQuery.mutate(
      params as QueryFileListSchemaType & { excludedIds?: string[] },
    );
  };

  // V2.0 Migrate from getFileItem to getKnowledgeItem
  // This method handles both files (file_ prefix) and documents (docs_ prefix)
  getKnowledgeItem = async (id: string) => {
    // Detect type based on ID prefix
    if (id.startsWith('docs_')) {
      // Document (including folders) - use document endpoint
      const doc = await lambdaClient.document.getDocumentById.query({ id });
      if (!doc) return null;

      const backingFile = doc.fileId
        ? await lambdaClient.file.getFileItemById.query({ id: doc.fileId })
        : undefined;

      // Convert document to FileListItem format
      return {
        chunkCount: null,
        chunkingError: null,
        chunkingStatus: null,
        content: doc.content,
        createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
        editorData: doc.editorData,
        embeddingError: null,
        embeddingStatus: null,
        fileId: doc.fileId,
        fileType: backingFile?.fileType || doc.fileType || CUSTOM_DOCUMENT_FILE_TYPE,
        finishEmbedding: false,
        id: doc.id,
        metadata: doc.metadata,
        name: backingFile?.name || doc.title || doc.filename || 'Untitled',
        parentId: doc.parentId,
        size: backingFile?.size || doc.totalCharCount || 0,
        slug: doc.slug,
        sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        url: backingFile?.url || doc.source || '',
      } as FileListItem;
    } else {
      // File - use dedicated file endpoint
      return lambdaClient.file.getFileItemById.query({ id });
    }
  };

  getFolderBreadcrumb = async (slug: string) => {
    return lambdaClient.document.getFolderBreadcrumb.query({ slug });
  };

  checkFileHash = async (hash: string): Promise<CheckFileHashResult> => {
    return lambdaClient.file.checkFileHash.mutate({ hash });
  };

  removeFileAsyncTask = async (id: string, type: 'embedding' | 'chunk') => {
    return lambdaClient.file.removeFileAsyncTask.mutate({ id, type });
  };

  updateFile = async (
    id: string,
    data: {
      metadata?: Record<string, any>;
      name?: string;
      parentId?: string | null;
    },
  ) => {
    return lambdaClient.file.updateFile.mutate({ id, ...data });
  };

  getRecentFiles = async (limit?: number) => {
    return lambdaClient.file.recentFiles.query({ limit });
  };

  getRecentPages = async (limit?: number) => {
    return lambdaClient.file.recentPages.query({ limit });
  };

  transferEntity = async (
    id: string,
    entityType: 'document' | 'file' | 'folder',
    targetWorkspaceId: string | null,
    targetVisibility?: 'private' | 'public',
  ) => {
    return lambdaClient.file.transferEntity.mutate({
      entityType,
      id,
      targetVisibility,
      targetWorkspaceId,
    });
  };

  copyEntityToWorkspace = async (
    id: string,
    entityType: 'document' | 'file' | 'folder',
    targetWorkspaceId: string | null,
    targetVisibility?: 'private' | 'public',
  ) => {
    return lambdaClient.file.copyEntityToWorkspace.mutate({
      entityType,
      id,
      targetVisibility,
      targetWorkspaceId,
    });
  };

  publishFileToWorkspace = async (id: string): Promise<void> => {
    await lambdaClient.file.publishFileToWorkspace.mutate({ id });
  };

  setFileVisibility = async (id: string, visibility: 'private' | 'public'): Promise<void> => {
    await lambdaClient.file.setFileVisibility.mutate({ id, visibility });
  };
}

export const fileService = new FileService();
