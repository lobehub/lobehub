import { type FileListItem } from '@/types/files';
import {
  type CreateResourceParams,
  type ResourceItem,
  type ResourceQueryParams,
  type UpdateResourceParams,
} from '@/types/resource';

import { type CreateDocumentParams } from '../document';
import { documentService } from '../document';
import { fileService } from '../file';

/**
 * Map FileListItem to ResourceItem
 */
const mapToResourceItem = (item: FileListItem): ResourceItem => {
  return {
    chunkCount: item.chunkCount,
    chunkTaskId: item.chunkingStatus ? 'placeholder' : null,
    chunkingError: item.chunkingError,
    chunkingStatus: item.chunkingStatus,
    // Document-specific fields
    content: item.content,

    createdAt: item.createdAt,

    editorData: item.editorData,

    embeddingError: item.embeddingError,

    embeddingStatus: item.embeddingStatus,

    embeddingTaskId: item.embeddingStatus ? 'placeholder' : null,

    fileType: item.fileType,

    finishEmbedding: item.finishEmbedding,

    id: item.id,

    // Metadata
    metadata: item.metadata || undefined,

    name: item.name,

    parentId: item.parentId,

    size: item.size,

    slug: item.slug,

    sourceType: item.sourceType as 'file' | 'document',

    updatedAt: item.updatedAt,

    // File-specific fields
    url: item.url,
  };
};

/**
 * ResourceService - Unified service for both files and documents
 * Provides a thin wrapper over FileService and DocumentService
 * Used by ResourceManager for optimistic updates
 */
export class ResourceService {
  /**
   * Query resources (unified files + documents)
   * Uses KnowledgeRepo UNION ALL query
   */
  async queryResources(params: ResourceQueryParams): Promise<{
    hasMore: boolean;
    items: ResourceItem[];
    total?: number;
  }> {
    // Map frontend parameter names to backend parameter names
    const backendParams = {
      ...params,
      knowledgeBaseId: params.libraryId, // Map libraryId to knowledgeBaseId
      libraryId: undefined, // Remove the frontend-specific parameter
    };

    const response = await fileService.getKnowledgeItems(backendParams);

    return {
      hasMore: response.hasMore,
      items: response.items.map(mapToResourceItem),
      total: 'total' in response ? (response.total as number) : undefined,
    };
  }

  /**
   * Get a single resource by ID
   */
  async getResource(id: string): Promise<ResourceItem | undefined> {
    const item = await fileService.getKnowledgeItem(id);
    return item ? mapToResourceItem(item) : undefined;
  }

  /**
   * Create a new resource (file or document)
   */
  async createResource(params: CreateResourceParams): Promise<ResourceItem> {
    if (params.sourceType === 'file') {
      // Create file
      const result = await fileService.createFile(
        {
          fileType: params.fileType,
          name: params.name,
          parentId: params.parentId,
          size: params.size,
          url: params.url,
        },
        params.knowledgeBaseId,
      );

      // Fetch the created file to get full details
      const created = await fileService.getKnowledgeItem(result.id);
      if (!created) throw new Error('Failed to fetch created file');

      return mapToResourceItem(created);
    } else {
      // Create document
      const documentParams: CreateDocumentParams = {
        content: params.content || '',
        editorData: JSON.stringify(params.editorData || {}),
        fileType: params.fileType,
        knowledgeBaseId: params.knowledgeBaseId,
        metadata: params.metadata,
        parentId: params.parentId,
        slug: params.slug,
        title: params.title,
      };

      const created = await documentService.createDocument(documentParams);

      // Map to ResourceItem
      return {
        content: created.content,
        createdAt: created.createdAt ? new Date(created.createdAt) : new Date(),
        editorData:
          typeof created.editorData === 'string'
            ? JSON.parse(created.editorData)
            : created.editorData,
        fileType: created.fileType || 'custom/document',
        id: created.id,
        metadata: created.metadata || undefined,
        name: created.title || 'Untitled',
        parentId: created.parentId,
        size: created.totalCharCount || 0,
        slug: created.slug || undefined,
        sourceType: 'document',
        title: created.title || undefined,
        updatedAt: created.updatedAt ? new Date(created.updatedAt) : new Date(),
        url: created.source || '',
      };
    }
  }

  /**
   * Update a resource
   */
  async updateResource(id: string, updates: UpdateResourceParams): Promise<ResourceItem> {
    // Check if this is a file or document by fetching it first
    const existing = await this.getResource(id);
    if (!existing) throw new Error('Resource not found');

    if (existing.sourceType === 'file') {
      // Update file (currently only supports parentId)
      if (updates.parentId !== undefined) {
        await fileService.updateFile(id, { parentId: updates.parentId });
      }

      // Fetch updated file
      const updated = await fileService.getKnowledgeItem(id);
      if (!updated) throw new Error('Failed to fetch updated file');

      return mapToResourceItem(updated);
    } else {
      // Update document
      await documentService.updateDocument({
        content: updates.content,
        editorData: updates.editorData ? JSON.stringify(updates.editorData) : undefined,
        id,
        metadata: updates.metadata,
        // Keep null as null (for moving to root), don't convert to undefined
        parentId: updates.parentId !== undefined ? updates.parentId : undefined,
        title: updates.title || updates.name,
      });

      // Fetch updated document
      const updated = await fileService.getKnowledgeItem(id);
      if (!updated) throw new Error('Failed to fetch updated document');

      return mapToResourceItem(updated);
    }
  }

  /**
   * Delete a resource
   */
  async deleteResource(id: string): Promise<void> {
    // Check if this is a file or document
    const existing = await this.getResource(id);
    if (!existing) return; // Already deleted

    if (existing.sourceType === 'file') {
      await fileService.removeFile(id);
    } else {
      await documentService.deleteDocument(id);
    }
  }

  /**
   * Batch delete resources
   */
  async deleteResources(ids: string[]): Promise<void> {
    // Separate files and documents
    const fileIds: string[] = [];
    const documentIds: string[] = [];

    await Promise.all(
      ids.map(async (id) => {
        const item = await this.getResource(id);
        if (item) {
          if (item.sourceType === 'file') {
            fileIds.push(id);
          } else {
            documentIds.push(id);
          }
        }
      }),
    );

    // Batch delete
    await Promise.all([
      fileIds.length > 0 ? fileService.removeFiles(fileIds) : Promise.resolve(),
      documentIds.length > 0 ? documentService.deleteDocuments(documentIds) : Promise.resolve(),
    ]);
  }

  /**
   * Move a resource to a different parent folder
   */
  async moveResource(id: string, parentId: string | null): Promise<ResourceItem> {
    return this.updateResource(id, { parentId });
  }
}

export const resourceService = new ResourceService();
