/**
 * Lobe Notebook Executor
 *
 * Handles notebook document operations.
 * The NotebookService is injected via constructor so both client and server can provide their own implementation.
 *
 * Note: listDocuments is not exposed as a tool - it's automatically injected by the system.
 */
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import {
  type CreateDocumentArgs,
  type DeleteDocumentArgs,
  type DocumentType,
  type GetDocumentArgs,
  NotebookApiName,
  NotebookIdentifier,
  type UpdateDocumentArgs,
} from '../types';

interface CreateDocumentParams {
  content: string;
  description: string;
  title: string;
  topicId: string;
  type?: DocumentType;
}

interface UpdateDocumentParams {
  append?: boolean;
  content?: string;
  id: string;
  title?: string;
}

export interface NotebookServiceApi {
  createDocument: (params: CreateDocumentParams) => Promise<any>;
  deleteDocument: (id: string) => Promise<any>;
  getDocument: (id: string) => Promise<any>;
  updateDocument: (params: UpdateDocumentParams) => Promise<any>;
}

export class NotebookExecutor extends BaseExecutor<typeof NotebookApiName> {
  readonly identifier = NotebookIdentifier;
  protected readonly apiEnum = NotebookApiName;

  private notebookService: NotebookServiceApi;

  constructor(notebookService: NotebookServiceApi) {
    super();
    this.notebookService = notebookService;
  }

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

      const document = await this.notebookService.createDocument({
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

      const document = await this.notebookService.updateDocument(params);

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

      const document = await this.notebookService.getDocument(params.id);

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

      await this.notebookService.deleteDocument(params.id);

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
