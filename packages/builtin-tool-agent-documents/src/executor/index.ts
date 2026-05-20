import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

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

export class AgentDocumentsExecutor extends BaseExecutor<typeof AgentDocumentsApiName> {
  readonly identifier = AgentDocumentsIdentifier;
  protected readonly apiEnum = AgentDocumentsApiName;

  private runtime: AgentDocumentsExecutionRuntime;

  constructor(runtime: AgentDocumentsExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

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
      messageId: ctx.sourceMessageId,
      operationId: ctx.operationId,
      scope: ctx.scope,
      taskId: ctx.taskId,
      toolCallId: ctx.toolCallId,
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
      scope: ctx.scope,
    });
  };

  modifyNodes = async (
    params: ModifyDocumentNodesArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.modifyNodes(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
    });
  };

  removeDocument = async (
    params: RemoveDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.removeDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
    });
  };

  renameDocument = async (
    params: RenameDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.renameDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
    });
  };

  copyDocument = async (
    params: CopyDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.copyDocument(params, {
      agentId: ctx.agentId,
      currentDocumentId: ctx.documentId,
      scope: ctx.scope,
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
