import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  DocumentReadFormat,
  DocumentRecord,
  DocumentRuntimeCreateParams,
  DocumentRuntimeModifyNodesParams,
  DocumentRuntimeReadParams,
  DocumentRuntimeReplaceContentParams,
  DocumentRuntimeService,
  DocumentToolTriggerInput,
  DocumentTriggerContext,
  ModifyDocumentOperation,
} from '../types';

export class DocumentRuntime {
  constructor(private service: DocumentRuntimeService) {}

  static buildToolTriggerInput(context?: DocumentTriggerContext): DocumentToolTriggerInput {
    if (!context?.messageId || !context.toolCallId) return {};

    const toolContext: DocumentToolTriggerInput['toolContext'] = {
      messageId: context.messageId,
      toolCallId: context.toolCallId,
    };

    if (context.operationId) toolContext.operationId = context.operationId;
    if (context.taskId) toolContext.taskId = context.taskId;
    if (context.topicId) toolContext.topicId = context.topicId;

    return {
      toolContext,
      trigger: 'tool',
    };
  }

  formatDocumentReadContent(doc: DocumentRecord, format: DocumentReadFormat = 'xml') {
    const markdown = doc.content || '';
    const xml = doc.litexml || '';

    if (format === 'markdown') return markdown;
    if (format === 'both') return JSON.stringify({ markdown, xml });

    return xml || markdown;
  }

  async createDocument<Params extends DocumentRuntimeCreateParams>(
    params: Params,
    options: {
      failureContent: string;
      successContent: (doc: DocumentRecord) => string;
      successState: (doc: DocumentRecord) => Record<string, unknown>;
      triggerContext?: DocumentTriggerContext;
    },
  ): Promise<BuiltinServerRuntimeOutput> {
    const created = await this.service.createDocument({
      ...params,
      ...DocumentRuntime.buildToolTriggerInput(options.triggerContext),
    });
    if (!created) return { content: options.failureContent, success: false };

    return {
      content: options.successContent(created),
      state: options.successState(created),
      success: true,
    };
  }

  async readDocument(
    params: DocumentRuntimeReadParams,
    options: { notFoundContent: (id: string) => string },
  ): Promise<BuiltinServerRuntimeOutput> {
    const doc = await this.service.readDocument(params);
    if (!doc) return { content: options.notFoundContent(params.id), success: false };

    const format = params.format ?? 'xml';

    return {
      content: this.formatDocumentReadContent(doc, format),
      state: { content: doc.content, id: doc.id, title: doc.title, xml: doc.litexml },
      success: true,
    };
  }

  async replaceContent(
    params: DocumentRuntimeReplaceContentParams,
    options: { failureContent: (id: string) => string; successContent: (id: string) => string },
  ): Promise<BuiltinServerRuntimeOutput> {
    const doc = await this.service.replaceContent(params);
    if (!doc) return { content: options.failureContent(params.id), success: false };

    return {
      content: options.successContent(params.id),
      state: { id: params.id, updated: true },
      success: true,
    };
  }

  async modifyNodes(
    params: DocumentRuntimeModifyNodesParams,
    options: {
      emptyOperationsContent: string;
      failureContent: (id: string) => string;
      successContent: (id: string, count: number) => string;
    },
  ): Promise<BuiltinServerRuntimeOutput> {
    const operations: ModifyDocumentOperation[] = Array.isArray(params.operations)
      ? params.operations
      : [];
    if (operations.length === 0) {
      return { content: options.emptyOperationsContent, success: false };
    }

    const updated = await this.service.modifyNodes({ id: params.id, operations });
    if (!updated) return { content: options.failureContent(params.id), success: false };

    const results = operations.map((operation) => ({
      action: operation.action,
      success: true,
    }));

    return {
      content: options.successContent(params.id, results.length),
      state: {
        id: params.id,
        results,
        successCount: results.length,
        totalCount: results.length,
      },
      success: true,
    };
  }

  async listDocuments(): Promise<BuiltinServerRuntimeOutput> {
    const docs = await this.service.listDocuments();
    const list = docs.map((d) => ({
      ...(d.documentId ? { documentId: d.documentId } : {}),
      filename: d.filename ?? d.title ?? '',
      id: d.id,
      title: d.title,
    }));

    return {
      content: JSON.stringify(list),
      state: { documents: list },
      success: true,
    };
  }
}
