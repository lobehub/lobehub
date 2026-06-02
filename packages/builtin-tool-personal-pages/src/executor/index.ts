import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { PersonalPagesExecutionRuntime } from '../ExecutionRuntime';
import {
  type CreatePageArgs,
  type ListPagesArgs,
  type ModifyNodesArgs,
  PersonalPagesApiName,
  PersonalPagesIdentifier,
  type ReadPageArgs,
  type ReplaceContentArgs,
} from '../types';

export class PersonalPagesExecutor extends BaseExecutor<typeof PersonalPagesApiName> {
  readonly identifier = PersonalPagesIdentifier;
  protected readonly apiEnum = PersonalPagesApiName;

  private runtime: PersonalPagesExecutionRuntime;

  constructor(runtime: PersonalPagesExecutionRuntime) {
    super();
    this.runtime = runtime;
  }

  createPage = async (
    params: CreatePageArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.runtime.createPage(params);

  readPage = async (params: ReadPageArgs, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.readPage(params);

  replaceContent = async (
    params: ReplaceContentArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.runtime.replaceContent(params);

  modifyNodes = async (
    params: ModifyNodesArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.runtime.modifyNodes(params);

  listPages = async (
    _params: ListPagesArgs,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.runtime.listPages();
}

const fallbackRuntime = new PersonalPagesExecutionRuntime({
  createDocument: async () => undefined,
  listDocuments: async () => [],
  modifyNodes: async () => undefined,
  readDocument: async () => undefined,
  replaceContent: async () => undefined,
});

export const personalPagesExecutor = new PersonalPagesExecutor(fallbackRuntime);
