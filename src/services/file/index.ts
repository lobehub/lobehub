import { lambdaClient } from '@/libs/trpc/client';
import {
  type CheckFileHashResult,
  type FileItem,
  type FileListItem,
  type QueryFileListParams,
  type QueryFileListSchemaType,
  type UploadFileParams,
} from '@/types/files';

interface CreateFileParams extends Omit<UploadFileParams, 'url'> {
  knowledgeBaseId?: string;
  parentId?: string;
  url: string;
}

export class FileService {
  createFile = async (
    params: UploadFileParams & { parentId?: string },
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

  removeAllFiles = async () => {
    await lambdaClient.file.removeAllFiles.mutate();
  };

  // V2.0 Migrate from getFiles to getKnowledgeItems
  getKnowledgeItems = async (params: QueryFileListParams) => {
    return lambdaClient.file.getKnowledgeItems.query(params as QueryFileListSchemaType);
  };

  // V2.0 Migrate from getFileItem to getKnowledgeItem
  // This method handles both files (file_ prefix) and documents (docs_ prefix)
  getKnowledgeItem = async (id: string) => {
    // Detect type based on ID prefix
    if (id.startsWith('docs_')) {
      // Document (including folders) - use document endpoint
      const doc = await lambdaClient.document.getDocumentById.query({ id });
      if (!doc) return null;

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
        fileType: doc.fileType || 'custom/document',
        finishEmbedding: false,
        id: doc.id,
        metadata: doc.metadata,
        name: doc.title || doc.filename || 'Untitled',
        parentId: doc.parentId,
        size: doc.totalCharCount || 0,
        slug: doc.slug,
        sourceType: 'document',
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        url: doc.source || '',
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

  updateFile = async (id: string, data: { parentId?: string | null }) => {
    return lambdaClient.file.updateFile.mutate({ id, ...data });
  };

  getRecentFiles = async (limit?: number) => {
    return lambdaClient.file.recentFiles.query({ limit });
  };

  getRecentPages = async (limit?: number) => {
    return lambdaClient.file.recentPages.query({ limit });
  };
}

export const fileService = new FileService();
