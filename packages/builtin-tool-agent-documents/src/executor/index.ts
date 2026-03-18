import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { AgentDocumentsExecutionRuntime } from '../ExecutionRuntime';
import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
  type CopyDocumentArgs,
  type CreateDocumentArgs,
  type EditDocumentArgs,
  type ReadDocumentArgs,
  type RemoveDocumentArgs,
  type RenameDocumentArgs,
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

  createDocument = async (
    params: CreateDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.createDocument(params, { agentId: ctx.agentId });
  };

  readDocument = async (
    params: ReadDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.readDocument(params, { agentId: ctx.agentId });
  };

  editDocument = async (
    params: EditDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.editDocument(params, { agentId: ctx.agentId });
  };

  removeDocument = async (
    params: RemoveDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.removeDocument(params, { agentId: ctx.agentId });
  };

  renameDocument = async (
    params: RenameDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.renameDocument(params, { agentId: ctx.agentId });
  };

  copyDocument = async (
    params: CopyDocumentArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.copyDocument(params, { agentId: ctx.agentId });
  };

  updateLoadRule = async (
    params: UpdateLoadRuleArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.runtime.updateLoadRule(params, { agentId: ctx.agentId });
  };
}

const fallbackRuntime = new AgentDocumentsExecutionRuntime({
  copyDocument: async ({ agentId: _agentId }) => undefined,
  createDocument: async () => undefined,
  editDocument: async ({ agentId: _agentId }) => undefined,
  readDocument: async ({ agentId: _agentId }) => undefined,
  removeDocument: async ({ agentId: _agentId }) => false,
  renameDocument: async ({ agentId: _agentId }) => undefined,
  updateLoadRule: async ({ agentId: _agentId }) => undefined,
});

export const agentDocumentsExecutor = new AgentDocumentsExecutor(fallbackRuntime);
