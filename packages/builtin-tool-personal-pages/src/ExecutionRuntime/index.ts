import { DocumentRuntime } from '@lobechat/builtin-tool-document-core';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CreatePageArgs,
  ModifyNodesArgs,
  PersonalPagesRuntimeService,
  ReadPageArgs,
  ReplaceContentArgs,
} from '../types';

export class PersonalPagesExecutionRuntime {
  private readonly core: DocumentRuntime;

  constructor(service: PersonalPagesRuntimeService) {
    this.core = new DocumentRuntime(service);
  }

  async createPage(args: CreatePageArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.core.createDocument(
      { content: args.content, title: args.title },
      {
        failureContent: 'Failed to create personal page.',
        successContent: (doc) => `Created page "${doc.title || args.title}" (${doc.id}).`,
        successState: (doc) => ({ pageId: doc.id }),
      },
    );
  }

  async readPage(args: ReadPageArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.core.readDocument(
      { format: args.format, id: args.id },
      { notFoundContent: (id) => `Page not found: ${id}` },
    );
  }

  async replaceContent(args: ReplaceContentArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.core.replaceContent(
      { content: args.content, id: args.id },
      {
        failureContent: (id) => `Failed to update page ${id}.`,
        successContent: (id) => `Updated page ${id}.`,
      },
    );
  }

  async modifyNodes(args: ModifyNodesArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.core.modifyNodes(
      { id: args.id, operations: args.operations },
      {
        emptyOperationsContent: 'No operations provided.',
        failureContent: (id) => `Failed to modify page ${id}.`,
        successContent: (id, count) => `Modified page ${id}. Applied ${count} operation(s).`,
      },
    );
  }

  async listPages(): Promise<BuiltinServerRuntimeOutput> {
    return this.core.listDocuments();
  }
}
