import {
  formatCopyDocumentResult,
  formatCreateDocumentResult,
  formatModifyDocumentResult,
  formatRemoveDocumentResult,
  formatRenameDocumentResult,
  formatReplaceDocumentResult,
  formatUpdateLoadRuleResult,
} from '@lobechat/prompts';
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
  rootOperationId?: string | null;
  scope?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  toolCallId?: string | null;
  toolMessageId?: string | null;
  topicId?: string | null;
}

/**
 * Attribution data captured from a builtin tool call that mutates an agent document.
 */
interface AgentDocumentToolContext {
  messageId: string;
  operationId?: string;
  rootOperationId?: string;
  taskId?: string | null;
  threadId?: string | null;
  toolCallId: string;
  toolMessageId?: string;
  topicId?: string;
}

/**
 * Tool-call attribution input for document mutation operations.
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

/**
 * Upper bound on the characters a single readDocument result feeds back into the
 * model context. Agent documents can hold whole email/newsletter archives that
 * run into the millions of characters; returning one whole once pushed a task
 * past the model's context window — a lone tool result reached ~591k tokens and
 * the next completion 400'd with ExceededContextWindow. The client Inspector
 * still renders the full document from `state`, so only the LLM-facing `content`
 * is capped. ~200k chars is roughly 50k tokens per field — generous for a real
 * document read while leaving ample room in the window.
 */
const MAX_READ_DOCUMENT_CONTENT_CHARS = 200_000;

type MaybePromise<T> = T | Promise<T>;

export interface AgentDocumentsRuntimeService {
  copyDocument: (
    params: CopyDocumentArgs & {
      agentId: string;
    } & AgentDocumentToolTriggerInput,
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
    } & AgentDocumentToolTriggerInput,
  ) => Promise<AgentDocumentRecord | undefined>;
  readDocument: (
    params: ReadDocumentArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
  removeDocument: (
    params: RemoveDocumentArgs & {
      agentId: string;
    } & AgentDocumentToolTriggerInput,
  ) => Promise<boolean>;
  renameDocument: (
    params: RenameDocumentArgs & {
      agentId: string;
    } & AgentDocumentToolTriggerInput,
  ) => Promise<AgentDocumentRecord | undefined>;
  replaceDocumentContent: (
    params: ReplaceDocumentContentArgs & {
      agentId: string;
    } & AgentDocumentToolTriggerInput,
  ) => Promise<AgentDocumentRecord | undefined>;
  updateLoadRule: (
    params: UpdateLoadRuleArgs & {
      agentId: string;
    },
  ) => Promise<AgentDocumentRecord | undefined>;
}

export interface AgentDocumentsRuntimeOptions {
  /**
   * Build a shareable URL that opens a document in the standalone document
   * route. When provided and it returns a URL, the create result surfaces the
   * link so the agent can relay it to the user (e.g. in an IM channel).
   */
  getDocumentUrl?: (params: {
    agentId: string;
    documentId: string;
  }) => MaybePromise<string | undefined>;
  /**
   * Fired after a document-mutating tool call finishes (create / remove /
   * rename / copy) so the host can invalidate client-side caches. This is the
   * only refresh signal for the server-runtime path — where the tool executes
   * on the gateway and the client service layer (which normally invalidates)
   * never runs. Invoked from the executor's `onAfterCall` lifecycle hook.
   */
  onDocumentsMutated?: () => MaybePromise<void>;
}

export class AgentDocumentsExecutionRuntime {
  constructor(
    private service: AgentDocumentsRuntimeService,
    private options: AgentDocumentsRuntimeOptions = {},
  ) {}

  /**
   * Notify the host that the document set changed so it can refresh client
   * state (e.g. the agent documents list). Invoked from the executor's
   * `onAfterCall` hook, which fires on `tool_end` regardless of whether the
   * mutation ran client- or server-side — covering the server-runtime path the
   * inline client service invalidation can't reach.
   */
  notifyMutated(): Promise<void> {
    return Promise.resolve(this.options.onDocumentsMutated?.());
  }

  private resolveAgentId(context?: AgentDocumentOperationContext) {
    if (!context?.agentId) return;
    return context.agentId;
  }

  /**
   * Resolve a shareable document url so every document-referencing result can
   * hand the user a clickable link instead of a raw internal id. Returns
   * undefined when no url builder is configured or the `documents` row id is
   * unknown — callers fall back to the id-only result wording in that case.
   */
  private buildDocumentUrl(agentId: string, documentId?: string): MaybePromise<string | undefined> {
    if (!documentId) return undefined;
    return this.options.getDocumentUrl?.({ agentId, documentId });
  }

  private getCurrentDocumentId(context?: AgentDocumentOperationContext) {
    if (context?.scope !== 'page') return;
    return context.currentDocumentId ?? undefined;
  }

  private resolveTopicId(context?: AgentDocumentOperationContext) {
    if (!context?.topicId) return;
    return context.topicId;
  }

  private buildToolTriggerInput(
    context?: AgentDocumentOperationContext,
  ): AgentDocumentToolTriggerInput {
    if (!context?.messageId || !context.toolCallId) return {};

    const toolContext: AgentDocumentToolContext = {
      messageId: context.messageId,
      toolCallId: context.toolCallId,
    };

    if (context.operationId) toolContext.operationId = context.operationId;
    if (context.rootOperationId) toolContext.rootOperationId = context.rootOperationId;
    if (context.taskId) toolContext.taskId = context.taskId;
    if (context.threadId) toolContext.threadId = context.threadId;
    if (context.toolMessageId) toolContext.toolMessageId = context.toolMessageId;
    if (context.topicId) toolContext.topicId = context.topicId;

    return {
      toolContext,
      trigger: 'tool',
    };
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

  /**
   * Cap a single field so one oversized document can't blow the model's context
   * window. Truncation is byte-cheap `slice` on characters (not tokens), so the
   * cap is deliberately conservative; the trailing marker tells the model the
   * document was cut and to work with a smaller/targeted read instead of
   * assuming it saw the whole thing.
   */
  private capReadContent(content: string) {
    if (content.length <= MAX_READ_DOCUMENT_CONTENT_CHARS) return content;

    // Avoid splitting a UTF-16 surrogate pair: if the cutoff lands right after a
    // high surrogate (e.g. half of an emoji), step back one code unit. Otherwise
    // JSON.stringify emits a lone `\uD83D`-style escape, which some upstream
    // providers (DeepSeek, Anthropic) reject — which would re-break the exact
    // large-document requests this cap is meant to protect.
    let cutoff = MAX_READ_DOCUMENT_CONTENT_CHARS;
    const lastCharCode = content.charCodeAt(cutoff - 1);
    if (lastCharCode >= 0xd8_00 && lastCharCode <= 0xdb_ff) cutoff -= 1;

    const omitted = content.length - cutoff;
    return (
      content.slice(0, cutoff) +
      `\n\n[... document truncated to fit the context window: ${omitted} of ${content.length} ` +
      `characters omitted. This is only the beginning of the document — do not assume it is ` +
      `complete. Read a smaller/specific document, or list and target sections instead of ` +
      `loading the whole file.]`
    );
  }

  private formatDocumentReadContent(
    doc: AgentDocumentRecord,
    format: 'xml' | 'markdown' | 'both' = 'xml',
  ) {
    const markdown = this.capReadContent(doc.content || '');
    const xml = this.capReadContent(doc.litexml || '');

    if (format === 'markdown') return markdown;
    if (format === 'both') return JSON.stringify({ markdown, xml });

    return xml || markdown;
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
    const parentId = args.parentId;
    const topicId = this.resolveTopicId(context);
    if (scope === 'currentTopic' && !topicId) {
      return {
        content: 'Cannot list current topic documents without topicId context.',
        success: false,
      };
    }

    const docs =
      scope === 'currentTopic'
        ? await this.service.listTopicDocuments({
            agentId,
            parentId,
            scope,
            sourceType,
            topicId: topicId!,
          })
        : await this.service.listDocuments({ agentId, parentId, scope, sourceType });
    const list = await Promise.all(
      docs.map(async (d) => {
        const url = await this.buildDocumentUrl(agentId, d.documentId);
        return {
          ...(d.documentId ? { documentId: d.documentId } : {}),
          filename: d.filename ?? d.title ?? '',
          id: d.id,
          title: d.title,
          // The clickable link lets the agent reference any listed document to
          // the user; omitted when no url builder is configured.
          ...(url ? { url } : {}),
        };
      }),
    );

    return {
      content: JSON.stringify(list),
      state: { documents: list },
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

    const scope = args.scope ?? 'agent';
    const topicId = this.resolveTopicId(context);
    if (scope === 'currentTopic' && !topicId) {
      return {
        content: 'Cannot create current topic document without topicId context.',
        success: false,
      };
    }

    const toolTriggerInput = this.buildToolTriggerInput(context);
    const created =
      scope === 'currentTopic'
        ? await this.service.createTopicDocument({
            ...args,
            ...toolTriggerInput,
            agentId,
            topicId: topicId!,
          })
        : await this.service.createDocument({ ...args, ...toolTriggerInput, agentId });
    if (!created) return { content: 'Failed to create agent document.', success: false };

    const title = created.title || args.title;
    // The document route is keyed by the `documents` id; the URL lets the agent
    // hand the user a clickable link. `created.id` (the agentDocuments row id)
    // is kept separately because subsequent edit/read/remove calls key off it.
    const url = await this.buildDocumentUrl(agentId, created.documentId);

    return {
      content: formatCreateDocumentResult({ id: created.id, title, url }),
      state: { agentDocumentId: created.id, documentId: created.documentId },
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

    const format = args.format ?? 'xml';

    return {
      content: this.formatDocumentReadContent(doc, format),
      state: { content: doc.content, id: doc.id, title: doc.title, xml: doc.litexml },
      success: true,
    };
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

    const doc = await this.service.replaceDocumentContent({
      ...args,
      ...this.buildToolTriggerInput(context),
      agentId,
    });
    if (!doc) return { content: `Failed to update document ${args.id}.`, success: false };

    const url = await this.buildDocumentUrl(agentId, doc.documentId ?? existing.documentId);

    return {
      content: formatReplaceDocumentResult({
        id: args.id,
        title: doc.title ?? existing.title,
        url,
      }),
      state: { id: args.id, updated: true },
      success: true,
    };
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

    const operations = Array.isArray(args.operations) ? args.operations : [];
    if (operations.length === 0) {
      return { content: 'No operations provided.', success: false };
    }

    const updated = await this.service.modifyNodes({
      agentId,
      ...this.buildToolTriggerInput(context),
      id: args.id,
      operations,
    });
    if (!updated) return { content: `Failed to modify document ${args.id}.`, success: false };

    const results = operations.map((operation) => ({
      action: operation.action,
      success: true,
    }));

    const url = await this.buildDocumentUrl(agentId, updated.documentId ?? existing.documentId);

    return {
      content: formatModifyDocumentResult({
        id: args.id,
        operationCount: results.length,
        title: updated.title ?? existing.title,
        url,
      }),
      state: {
        id: args.id,
        results,
        successCount: results.length,
        totalCount: results.length,
      },
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

    const deleted = await this.service.removeDocument({
      ...args,
      ...this.buildToolTriggerInput(context),
      agentId,
    });
    if (!deleted) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: formatRemoveDocumentResult({ id: args.id }),
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

    const doc = await this.service.renameDocument({
      ...args,
      ...this.buildToolTriggerInput(context),
      agentId,
    });
    if (!doc) return { content: `Failed to rename document ${args.id}.`, success: false };

    const url = await this.buildDocumentUrl(agentId, doc.documentId ?? existing.documentId);

    return {
      content: formatRenameDocumentResult({ id: args.id, title: args.newTitle, url }),
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

    const copied = await this.service.copyDocument({
      ...args,
      ...this.buildToolTriggerInput(context),
      agentId,
    });
    if (!copied) return { content: `Document not found: ${args.id}`, success: false };

    const url = await this.buildDocumentUrl(agentId, copied.documentId);

    return {
      content: formatCopyDocumentResult({
        fromId: args.id,
        id: copied.id,
        title: copied.title,
        url,
      }),
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

    const url = await this.buildDocumentUrl(agentId, updated.documentId);

    return {
      content: formatUpdateLoadRuleResult({ id: args.id, title: updated.title, url }),
      state: { applied: true, rule: args.rule },
      success: true,
    };
  }
}
