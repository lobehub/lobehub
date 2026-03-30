import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CopyDocumentArgs,
  CreateDocumentArgs,
  EditDocumentArgs,
  ListDocumentsArgs,
  ReadDocumentArgs,
  ReadDocumentByFilenameArgs,
  RemoveDocumentArgs,
  RenameDocumentArgs,
  UpdateLoadRuleArgs,
  UpsertDocumentByFilenameArgs,
} from '../types';

interface AgentDocumentRecord {
  content?: string;
  filename?: string;
  id: string;
  title?: string;
}

interface AgentDocumentOperationContext {
  agentId?: string | null;
}

export interface AgentDocumentsRuntimeService {
  copyDocument: (
    params: CopyDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  createDocument: (
    params: CreateDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  editDocument: (
    params: EditDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  listDocuments: (
    params: ListDocumentsArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord[]>;
  readDocument: (
    params: ReadDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  readDocumentByFilename: (
    params: ReadDocumentByFilenameArgs & {
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
  updateLoadRule: (
    params: UpdateLoadRuleArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  upsertDocumentByFilename: (
    params: UpsertDocumentByFilenameArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
}

export class AgentDocumentsExecutionRuntime {
  constructor(private service: AgentDocumentsRuntimeService) {}

  private resolveAgentId(context?: AgentDocumentOperationContext) {
    if (!context?.agentId) return;
    return context.agentId;
  }

  async listDocuments(
    _args: ListDocumentsArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot list agent documents without agentId context.',
        success: false,
      };
    }

    const docs = await this.service.listDocuments({ agentId });
    const list = docs.map((d) => ({
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

  async readDocumentByFilename(
    args: ReadDocumentByFilenameArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot read agent document without agentId context.',
        success: false,
      };
    }

    const doc = await this.service.readDocumentByFilename({ ...args, agentId });
    if (!doc) return { content: `Document not found: ${args.filename}`, success: false };

    return {
      content: doc.content || '',
      state: { content: doc.content, filename: args.filename, id: doc.id, title: doc.title },
      success: true,
    };
  }

  async upsertDocumentByFilename(
    args: UpsertDocumentByFilenameArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot upsert agent document without agentId context.',
        success: false,
      };
    }

    const doc = await this.service.upsertDocumentByFilename({ ...args, agentId });
    if (!doc) return { content: `Failed to upsert document: ${args.filename}`, success: false };

    return {
      content: `Upserted document "${args.filename}" (${doc.id}).`,
      state: { filename: args.filename, id: doc.id },
      success: true,
    };
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

    const created = await this.service.createDocument({ ...args, agentId });
    if (!created) return { content: 'Failed to create agent document.', success: false };

    return {
      content: `Created document "${created.title || args.title}" (${created.id}).`,
      state: { documentId: created.id },
      success: true,
    };
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

    const doc = await this.service.readDocument({ ...args, agentId });
    if (!doc) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: doc.content || '',
      state: { content: doc.content, id: doc.id, title: doc.title },
      success: true,
    };
  }

  async editDocument(
    args: EditDocumentArgs,
    context?: AgentDocumentOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) {
      return {
        content: 'Cannot edit agent document without agentId context.',
        success: false,
      };
    }

    const doc = await this.service.editDocument({ ...args, agentId });
    if (!doc) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: `Updated document ${args.id}.`,
      state: { id: args.id, updated: true },
      success: true,
    };
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

    const doc = await this.service.renameDocument({ ...args, agentId });
    if (!doc) return { content: `Document not found: ${args.id}`, success: false };

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
