/**
 * Lobe Notebook Executor
 *
 * Handles notebook document operations via tRPC API calls.
 * All operations are delegated to the server since they require database access.
 *
 * Note: listDocuments is not exposed as a tool - it's automatically injected by the system.
 */
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { notebookService } from '@/services/notebook';

import {
  type CreateDocumentArgs,
  type DeleteDocumentArgs,
  type GetDocumentArgs,
  NotebookApiName,
  NotebookIdentifier,
  type UpdateDocumentArgs,
} from '../types';

class NotebookExecutor extends BaseExecutor<typeof NotebookApiName> {
  readonly identifier = NotebookIdentifier;
  protected readonly apiEnum = NotebookApiName;

  /**
   * Create a new document
   */
  createDocument = async (
    params: CreateDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      if (!ctx.topicId) {
        return {
          content: 'Cannot create document: no topic selected',
          success: false,
        };
      }

      const document = await notebookService.createDocument({
        content: params.content,
        description: params.description,
        title: params.title,
        topicId: ctx.topicId,
        type: params.type,
      });

      return {
        content: `📝 Document "${document.title}" created successfully`,
        state: { document },
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Update an existing document
   */
  updateDocument = async (
    params: UpdateDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const document = await notebookService.updateDocument(params);

      return {
        content: `✏️ Document updated successfully`,
        state: { document },
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Get a document by ID
   */
  getDocument = async (
    params: GetDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const document = await notebookService.getDocument(params.id);

      if (!document) {
        return {
          content: `Document not found: ${params.id}`,
          success: false,
        };
      }

      return {
        content: document.content || '',
        state: { document },
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Delete a document
   */
  deleteDocument = async (
    params: DeleteDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      await notebookService.deleteDocument(params.id);

      return {
        content: `🗑️ Document deleted successfully`,
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };
}

// Export the executor instance for registration
export const notebookExecutor = new NotebookExecutor();
