import type { DocumentRuntimeService } from '@lobechat/builtin-tool-document-core';
import { DocumentRuntime } from '@lobechat/builtin-tool-document-core';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CopyDocumentArgs,
  CreateDocumentArgs,
  ListDocumentsArgs,
  ModifyDocumentNodesArgs,
  ReadDocumentArgs,
  RemoveDocumentArgs,
  RenameDocumentArgs,
  ReplaceDocumentContentArgs,
  UpdateLoadRuleArgs,
} from '../types';

interface AgentDocumentRecord {
  content?: string;
  /**
   * The underlying `documents` table id. Used for portal rendering
   * (opening the document in the shared EditorCanvas), which must resolve
   * the row in `documents` — distinct from `id` which is the
   * `agentDocuments` association row id.
   */
  documentId?: string;
  filename?: string;
  /**
   * The `agentDocuments` association row id. This is what the LLM receives
   * and uses for subsequent operations (read/edit/remove/...).
   */
  id: string;
  litexml?: string;
  title?: string;
}

interface AgentDocumentOperationContext {
  agentId?: string | null;
  currentDocumentId?: string | null;
  messageId?: string | null;
  operationId?: string | null;
  scope?: string | null;
  taskId?: string | null;
  toolCallId?: string | null;
  topicId?: string | null;
}

/**
 * Attribution data captured from a builtin tool call that creates an agent document.
 */
interface AgentDocumentToolContext {
  messageId: string;
  operationId?: string;
  taskId?: string | null;
  toolCallId: string;
  topicId?: string;
}

/**
 * Tool-call attribution input for document create operations.
 */
interface AgentDocumentToolTriggerInput {
  /**
   * Same-turn tool-call context used by create-class services to attribute generated documents.
   */
  toolContext?: AgentDocumentToolContext;
  /**
   * Set to `'tool'` only when the same-turn user message id and tool call id are both available.
   */
  trigger?: 'tool';
}

const CURRENT_PAGE_DOCUMENT_WRITE_ERROR_CODE = 'CURRENT_PAGE_DOCUMENT_WRITE_FORBIDDEN';
const CURRENT_PAGE_DOCUMENT_WRITE_ERROR_TYPE = 'CurrentPageDocumentWriteForbidden';

export interface AgentDocumentsRuntimeService {
  copyDocument: (
    params: CopyDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  createDocument: (
    params: CreateDocumentArgs & {
      agentId: string;
    } & AgentDocumentToolTriggerInput,
  ) => Promise<AgentDocumentRecord | undefined>;
  createTopicDocument: (
    params: CreateDocumentArgs & {
      agentId: string;
      topicId: string;
    } & AgentDocumentToolTriggerInput,
  ) => Promise<AgentDocumentRecord | undefined>;
  listDocuments: (
    params: ListDocumentsArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord[]>;
  listTopicDocuments: (
    params: ListDocumentsArgs & {
      agentId: string;
      topicId: string;
    },
  ) => Promise<AgentDocumentRecord[]>;
  modifyNodes: (
    params: ModifyDocumentNodesArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  readDocument: (
    params: ReadDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  removeDocument: (
    params: RemoveDocumentArgs & {
      agentId: string;
    },
  ) => Promise<boolean>;
  renameDocument: (
    params: RenameDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  replaceDocumentContent: (
    params: ReplaceDocumentContentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  updateLoadRule: (
    params: UpdateLoadRuleArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
}

interface AgentDocumentCoreScope {
  agentId: string;
  sourceType?: ListDocumentsArgs['sourceType'];
  topicId?: string;
}

export class AgentDocumentsExecutionRuntime {
  constructor(private service: AgentDocumentsRuntimeService) {}

  private buildCoreService({
    agentId,
    sourceType,
    topicId,
  }: AgentDocumentCoreScope): DocumentRuntimeService {
    return {
      createDocument: ({ content, title, ...trigger }) =>
        topicId
          ? this.service.createTopicDocument({ ...trigger, agentId, content, title, topicId })
          : this.service.createDocument({ ...trigger, agentId, content, title }),
      listDocuments: () =>
        topicId
          ? this.service.listTopicDocuments({ agentId, scope: 'currentTopic', sourceType, topicId })
          : this.service.listDocuments({ agentId, scope: 'agent', sourceType }),
      modifyNodes: ({ id, operations }) => this.service.modifyNodes({ agentId, id, operations }),
      readDocument: ({ format, id }) => this.service.readDocument({ agentId, format, id }),
      replaceContent: ({ content, id }) =>
        this.service.replaceDocumentContent({ agentId, content, id }),
    };
  }

  private coreFor(scope: AgentDocumentCoreScope) {
    return new DocumentRuntime(this.buildCoreService(scope));
  }

  private resolveAgentId(context?: AgentDocumentOperationContext) {
    if (!context?.agentId) return;
    return context.agentId;
  }

  private getCurrentDocumentId(context?: AgentDocumentOperationContext) {
    if (context?.scope !== 'page') return;
    return context.currentDocumentId ?? undefined;
  }

  private resolveTopicId(context?: AgentDocumentOperationContext) {
    if (!context?.topicId) return;
    return context.topicId;
  }

  private buildCurrentPageDocumentWriteBlockedResult(apiName: string): BuiltinServerRuntimeOutput {
    const message =
      `Cannot use lobe-agent-documents.${apiName} on the current page document ` +
      `while page scope is active. Use lobe-page-agent so the open editor shows a diff node ` +
      `for review instead of writing directly to the database.`;

    return {
      content: message,
      error: {
        code: CURRENT_PAGE_DOCUMENT_WRITE_ERROR_CODE,
        kind: 'replan',
        message,
        type: CURRENT_PAGE_DOCUMENT_WRITE_ERROR_TYPE,
      },
      success: false,
    };
  }

  private isCurrentPageDocument(
    doc: AgentDocumentRecord | undefined,
    context?: AgentDocumentOperationContext,
  ) {
    const currentDocumentId = this.getCurrentDocumentId(context);
    if (!currentDocumentId || !doc?.documentId) return false;

    return doc.documentId === currentDocumentId;
  }

  async listDocuments(
    args: ListDocumentsArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot list agent documents without agentId context.',
        success: false,
      };
    }

    const scope = args.scope ?? 'agent';
    const sourceType = args.sourceType ?? 'all';
    const topicId = this.resolveTopicId(context);
    if (scope === 'currentTopic' && !topicId) {
      return {
        content: 'Cannot list current topic documents without topicId context.',
        success: false,
      };
    }

    return this.coreFor({
      agentId,
      sourceType,
      ...(scope === 'currentTopic' ? { topicId } : {}),
    }).listDocuments();
  }

  async createDocument(
    args: CreateDocumentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot create agent document without agentId context.',
        success: false,
      };
    }

    const scope = args.scope ?? 'agent';
    const topicId = this.resolveTopicId(context);
    if (scope === 'currentTopic' && !topicId) {
      return {
        content: 'Cannot create current topic document without topicId context.',
        success: false,
      };
    }

    return this.coreFor({
      agentId,
      ...(scope === 'currentTopic' ? { topicId } : {}),
    }).createDocument(args, {
      failureContent: 'Failed to create agent document.',
      successContent: (doc) => `Created document "${doc.title || args.title}" (${doc.id}).`,
      successState: (doc) => ({ agentDocumentId: doc.id, documentId: doc.documentId }),
      triggerContext: context,
    });
  }

  async readDocument(
    args: ReadDocumentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot read agent document without agentId context.',
        success: false,
      };
    }

    return this.coreFor({ agentId }).readDocument(
      { format: args.format, id: args.id },
      { notFoundContent: (id) => `Document not found: ${id}` },
    );
  }

  async replaceDocumentContent(
    args: ReplaceDocumentContentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot replace agent document content without agentId context.',
        success: false,
      };
    }

    const existing = await this.service.readDocument({ agentId, id: args.id });
    if (!existing) return { content: `Document not found: ${args.id}`, success: false };

    if (this.isCurrentPageDocument(existing, context)) {
      return this.buildCurrentPageDocumentWriteBlockedResult('replaceDocumentContent');
    }

    return this.coreFor({ agentId }).replaceContent(
      { content: args.content, id: args.id },
      {
        failureContent: (id) => `Failed to update document ${id}.`,
        successContent: (id) => `Updated document ${id}.`,
      },
    );
  }

  async modifyNodes(
    args: ModifyDocumentNodesArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot modify agent document nodes without agentId context.',
        success: false,
      };
    }

    const existing = await this.service.readDocument({ agentId, id: args.id });
    if (!existing) return { content: `Document not found: ${args.id}`, success: false };

    if (this.isCurrentPageDocument(existing, context)) {
      return this.buildCurrentPageDocumentWriteBlockedResult('modifyNodes');
    }

    return this.coreFor({ agentId }).modifyNodes(
      { id: args.id, operations: args.operations },
      {
        emptyOperationsContent: 'No operations provided.',
        failureContent: (id) => `Failed to modify document ${id}.`,
        successContent: (id, count) => `Modified document ${id}. Applied ${count} operation(s).`,
      },
    );
  }

  async removeDocument(
    args: RemoveDocumentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot remove agent document without agentId context.',
        success: false,
      };
    }

    const deleted = await this.service.removeDocument({ ...args, agentId });
    if (!deleted) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: `Removed document ${args.id}.`,
      state: { deleted: true, id: args.id },
      success: true,
    };
  }

  async renameDocument(
    args: RenameDocumentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot rename agent document without agentId context.',
        success: false,
      };
    }

    const existing = await this.service.readDocument({ agentId, id: args.id });
    if (!existing) return { content: `Document not found: ${args.id}`, success: false };

    if (this.isCurrentPageDocument(existing, context)) {
      return this.buildCurrentPageDocumentWriteBlockedResult('renameDocument');
    }

    const doc = await this.service.renameDocument({ ...args, agentId });
    if (!doc) return { content: `Failed to rename document ${args.id}.`, success: false };

    return {
      content: `Renamed document ${args.id} to "${args.newTitle}".`,
      state: { id: args.id, newTitle: args.newTitle, renamed: true },
      success: true,
    };
  }

  async copyDocument(
    args: CopyDocumentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot copy agent document without agentId context.',
        success: false,
      };
    }

    const copied = await this.service.copyDocument({ ...args, agentId });
    if (!copied) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: `Copied document ${args.id} to ${copied.id}.`,
      state: { copiedFromId: args.id, newDocumentId: copied.id },
      success: true,
    };
  }

  async updateLoadRule(
    args: UpdateLoadRuleArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot update load rule without agentId context.',
        success: false,
      };
    }

    const updated = await this.service.updateLoadRule({ ...args, agentId });
    if (!updated) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: `Updated load rule for document ${args.id}.`,
      state: { applied: true, rule: args.rule },
      success: true,
    };
  }
}
