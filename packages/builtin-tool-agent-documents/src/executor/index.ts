import {
  BaseExecutor,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type ToolAfterCallContext,
} from '@lobechat/types';

import { AgentDocumentsExecutionRuntime } from '../ExecutionRuntime';
import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
  type CopyDocumentArgs,
  type CreateDocumentArgs,
  type ListDocumentsArgs,
  type ModifyDocumentNodesArgs,
  type ReadDocumentArgs,
  type RemoveDocumentArgs,
  type RenameDocumentArgs,
  type ReplaceDocumentContentArgs,
  type UpdateLoadRuleArgs,
} from '../types';

// APIs that change the document set the client list renders (membership or
// visible title). Content-only edits (replaceDocumentContent / modifyNodes) and
// read-only calls are excluded — they don't alter the list. Used by
// `onAfterCall` to decide when to refresh the client-side documents list.
const LIST_MUTATING_APIS = new Set<string>([
  AgentDocumentsApiName.createDocument,
  AgentDocumentsApiName.removeDocument,
  AgentDocumentsApiName.renameDocument,
  AgentDocumentsApiName.copyDocument,
]);

export class AgentDocumentsExecutor extends BaseExecutor<typeof AgentDocumentsApiName> {
  readonly identifier = AgentDocumentsIdentifier;
  protected readonly apiEnum = AgentDocumentsApiName;

  private runtime: AgentDocumentsExecutionRuntime;

  constructor(runtime: AgentDocumentsExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  // Refresh the client documents list after the agent mutates it. Fires on
  // `tool_end` regardless of whether the tool ran client- or server-side — the
  // server-runtime path never touches the client store otherwise, so a created
  // doc wouldn't appear until a manual refresh.
  onAfterCall = async ({ apiName, result }: ToolAfterCallContext): Promise<void> => {
    if (!result.success) return;

    const state = result.state as
      | {
          documentContent?: unknown;
          documentEditorData?: unknown;
          documentId?: unknown;
          documentTitle?: unknown;
          updatedAt?: unknown;
        }
      | undefined;
    const documentId = typeof state?.documentId === 'string' ? state.documentId : undefined;
    if (documentId) {
      const content =
        typeof state?.documentContent === 'string' ? state.documentContent : undefined;
      const title = typeof state?.documentTitle === 'string' ? state.documentTitle : undefined;
      const editorData =
        state?.documentEditorData && typeof state.documentEditorData === 'object'
          ? (state.documentEditorData as Record<string, unknown>)
          : state?.documentEditorData === null
            ? null
            : undefined;
      const updatedAt =
        state?.updatedAt instanceof Date || typeof state?.updatedAt === 'string'
          ? state.updatedAt
          : undefined;
      await this.runtime.notifyDocumentWritten({
        content,
        documentId,
        editorData,
        title,
        updatedAt,
      });
    }

    if (!LIST_MUTATING_APIS.has(apiName)) return;
    await this.runtime.notifyMutated();
  };

  listDocuments = async (
    params: ListDocumentsArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.listDocuments(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
      topicId: ctx.topicId,
    });
  };

  createDocument = async (
    params: CreateDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.createDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      messageId: ctx.sourceMessageId ?? ctx.messageId,
      operationId: ctx.operationId,
      rootOperationId: ctx.rootOperationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      toolMessageId: ctx.toolMessageId,
      topicId: ctx.topicId,
    });
  };

  readDocument = async (
    params: ReadDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.readDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
    });
  };

  replaceDocumentContent = async (
    params: ReplaceDocumentContentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.replaceDocumentContent(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      messageId: ctx.sourceMessageId ?? ctx.messageId,
      operationId: ctx.operationId,
      rootOperationId: ctx.rootOperationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      toolMessageId: ctx.toolMessageId,
      topicId: ctx.topicId,
    });
  };

  modifyNodes = async (
    params: ModifyDocumentNodesArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.modifyNodes(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      messageId: ctx.sourceMessageId ?? ctx.messageId,
      operationId: ctx.operationId,
      rootOperationId: ctx.rootOperationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      toolMessageId: ctx.toolMessageId,
      topicId: ctx.topicId,
    });
  };

  removeDocument = async (
    params: RemoveDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.removeDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      messageId: ctx.sourceMessageId ?? ctx.messageId,
      operationId: ctx.operationId,
      rootOperationId: ctx.rootOperationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      toolMessageId: ctx.toolMessageId,
      topicId: ctx.topicId,
    });
  };

  renameDocument = async (
    params: RenameDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.renameDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      messageId: ctx.sourceMessageId ?? ctx.messageId,
      operationId: ctx.operationId,
      rootOperationId: ctx.rootOperationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      toolMessageId: ctx.toolMessageId,
      topicId: ctx.topicId,
    });
  };

  copyDocument = async (
    params: CopyDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.copyDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      messageId: ctx.sourceMessageId ?? ctx.messageId,
      operationId: ctx.operationId,
      rootOperationId: ctx.rootOperationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      toolMessageId: ctx.toolMessageId,
      topicId: ctx.topicId,
    });
  };

  updateLoadRule = async (
    params: UpdateLoadRuleArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.updateLoadRule(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
    });
  };
}

const fallbackRuntime = new AgentDocumentsExecutionRuntime({
  copyDocument: async ({ agentId: _agentId }) => undefined,
  createDocument: async () => undefined,
  createTopicDocument: async () => undefined,
  listDocuments: async () => [],
  listTopicDocuments: async () => [],
  modifyNodes: async ({ agentId: _agentId }) => undefined,
  readDocument: async ({ agentId: _agentId }) => undefined,
  removeDocument: async ({ agentId: _agentId }) => false,
  renameDocument: async ({ agentId: _agentId }) => undefined,
  replaceDocumentContent: async ({ agentId: _agentId }) => undefined,
  updateLoadRule: async ({ agentId: _agentId }) => undefined,
});

export const agentDocumentsExecutor = new AgentDocumentsExecutor(fallbackRuntime);
