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
import { sha256 } from 'js-sha256';

import type {
  CopyDocumentArgs,
  CreateDocumentArgs,
  ListDocumentsArgs,
  ModifyDocumentNodesArgs,
  ReadDocumentArgs,
  ReadDocumentContinuation,
  ReadDocumentRange,
  ReadDocumentState,
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
 * A readDocument result is always an explicit window. The default keeps a
 * single tool result around 12k tokens while the hard ceiling protects the
 * context window from a caller-supplied oversized limit. The Inspector still
 * receives the full document snapshot through `state`.
 */
export const DEFAULT_READ_DOCUMENT_LIMIT = 50_000;
export const MAX_READ_DOCUMENT_LIMIT = 200_000;

type MaybePromise<T> = T | Promise<T>;

interface DocumentReadWindow {
  content: string;
  continuation?: ReadDocumentContinuation;
  hasMore: boolean;
  nextOffset?: number;
  range: ReadDocumentRange;
}

const countNewlines = (content: string) => {
  let count = 0;
  for (const char of content) {
    if (char === '\n') count += 1;
  }
  return count;
};

const isHighSurrogate = (code: number) => code >= 0xd8_00 && code <= 0xdb_ff;
const isLowSurrogate = (code: number) => code >= 0xdc_00 && code <= 0xdf_ff;

const lineNumberAtOffset = (content: string, offset: number) =>
  1 + countNewlines(content.slice(0, offset));

const resolveWindowEnd = (content: string, start: number, requestedEnd: number) => {
  let end = requestedEnd;

  if (end < content.length) {
    const lineBoundary = content.lastIndexOf('\n', end - 1);
    if (lineBoundary >= start) end = lineBoundary + 1;
  }

  // Never split a UTF-16 surrogate pair. If the requested window can only hold
  // half of one code point, include the whole pair so continuation advances.
  if (end > start && isHighSurrogate(content.charCodeAt(end - 1))) {
    end = end - start > 1 ? end - 1 : Math.min(content.length, requestedEnd + 1);
  }

  return end;
};

const buildReadWindow = (
  content: string,
  {
    format,
    id,
    limit,
    offset,
  }: {
    format: ReadDocumentContinuation['format'];
    id: string;
    limit: number;
    offset: number;
  },
): DocumentReadWindow => {
  let start = Math.min(offset, content.length);
  if (start < content.length && isLowSurrogate(content.charCodeAt(start))) {
    start += 1;
  }

  const requestedEnd = Math.min(content.length, start + limit);
  const end = resolveWindowEnd(content, start, requestedEnd);
  const windowContent = content.slice(start, end);
  const totalLines = 1 + countNewlines(content);
  const startLine = lineNumberAtOffset(content, start);
  const returnedLines = countNewlines(windowContent);
  const endLine =
    windowContent.length === 0
      ? startLine
      : startLine + returnedLines - (windowContent.endsWith('\n') ? 1 : 0);
  const hasMore = end < content.length;
  const range: ReadDocumentRange = {
    endLine,
    endOffset: end,
    length: windowContent.length,
    startLine,
    startOffset: start,
    totalLength: content.length,
    totalLines,
  };
  const continuation: ReadDocumentContinuation | undefined = hasMore
    ? {
        format,
        id,
        limit,
        offset: end,
      }
    : undefined;

  return {
    ...(continuation && { continuation, nextOffset: end }),
    content: windowContent,
    hasMore,
    range,
  };
};

const renderWindowedReadContent = ({
  contentHash,
  id,
  window,
}: {
  contentHash: string;
  id: string;
  window: DocumentReadWindow;
}): string => {
  const metadata = JSON.stringify({
    contentHash,
    endLine: window.range.endLine,
    endOffset: window.range.endOffset,
    hasMore: window.hasMore,
    id,
    length: window.range.length,
    nextOffset: window.nextOffset,
    startLine: window.range.startLine,
    startOffset: window.range.startOffset,
    totalLength: window.range.totalLength,
    totalLines: window.range.totalLines,
  });

  return [
    '<document_read_metadata>',
    metadata,
    '</document_read_metadata>',
    window.content,
    ...(window.continuation
      ? [
          '<document_read_continuation>',
          JSON.stringify(window.continuation),
          '</document_read_continuation>',
        ]
      : ['<document_read_complete />']),
  ].join('\n');
};

const validateReadWindowArgs = (
  args: ReadDocumentArgs,
): { error: string } | { limit: number; offset: number } => {
  const limit = args.limit ?? DEFAULT_READ_DOCUMENT_LIMIT;
  const offset = args.offset ?? 0;

  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_READ_DOCUMENT_LIMIT) {
    return {
      error: `Invalid readDocument limit: expected an integer from 1 to ${MAX_READ_DOCUMENT_LIMIT}.`,
    };
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return { error: 'Invalid readDocument offset: expected a non-negative integer.' };
  }

  return { limit, offset };
};

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
      state: { agentDocumentId: created.id, agentId, documentId: created.documentId },
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

    const validated = validateReadWindowArgs(args);
    if ('error' in validated) {
      return { content: validated.error, success: false };
    }

    const markdown = doc.content || '';
    const xml = doc.litexml || '';
    const requestedFormat = args.format ?? 'xml';
    // XML node ids are regenerated when the editor snapshot is projected. Hash
    // the canonical Markdown source so every window of one document revision
    // carries the same provenance hash.
    const contentHash = `sha256:${sha256(markdown)}`;
    const state: ReadDocumentState = {
      content: markdown,
      contentHash,
      id: doc.id,
      title: doc.title,
      xml,
    };

    if (requestedFormat === 'both') {
      const markdownWindow = buildReadWindow(markdown, {
        format: 'markdown',
        id: doc.id,
        limit: validated.limit,
        offset: validated.offset,
      });
      const xmlWindow = buildReadWindow(xml, {
        format: 'xml',
        id: doc.id,
        limit: validated.limit,
        offset: validated.offset,
      });
      const windowed = markdownWindow.hasMore || xmlWindow.hasMore || validated.offset > 0;
      const primaryWindow = xml.length > 0 ? xmlWindow : markdownWindow;
      const continuations = {
        ...(markdownWindow.continuation && { markdown: markdownWindow.continuation }),
        ...(xmlWindow.continuation && { xml: xmlWindow.continuation }),
      };
      const ranges = {
        markdown: markdownWindow.range,
        xml: xmlWindow.range,
      };

      return {
        content: windowed
          ? JSON.stringify(
              {
                continuations,
                markdown: renderWindowedReadContent({
                  contentHash,
                  id: doc.id,
                  window: markdownWindow,
                }),
                ranges,
                xml: renderWindowedReadContent({
                  contentHash,
                  id: doc.id,
                  window: xmlWindow,
                }),
              },
              null,
              2,
            )
          : JSON.stringify({ markdown, xml }),
        state: {
          ...state,
          ...(primaryWindow.continuation && { continuation: primaryWindow.continuation }),
          ...(Object.keys(continuations).length > 0 && { continuations }),
          format: 'both',
          hasMore: markdownWindow.hasMore || xmlWindow.hasMore,
          ...(primaryWindow.nextOffset !== undefined && {
            nextOffset: primaryWindow.nextOffset,
          }),
          range: primaryWindow.range,
          ranges,
        },
        success: true,
      };
    }

    const actualFormat =
      requestedFormat === 'markdown' || !xml ? 'markdown' : ('xml' as 'markdown' | 'xml');
    const source = actualFormat === 'markdown' ? markdown : xml;
    const window = buildReadWindow(source, {
      format: actualFormat,
      id: doc.id,
      limit: validated.limit,
      offset: validated.offset,
    });
    const windowed = window.hasMore || validated.offset > 0;

    return {
      content: windowed
        ? renderWindowedReadContent({ contentHash, id: doc.id, window })
        : window.content,
      state: {
        ...state,
        ...(window.continuation && { continuation: window.continuation }),
        format: actualFormat,
        hasMore: window.hasMore,
        ...(window.nextOffset !== undefined && { nextOffset: window.nextOffset }),
        range: window.range,
      },
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
      state: {
        agentDocumentId: args.id,
        agentId,
        documentId: doc.documentId ?? existing.documentId,
        id: args.id,
        updated: true,
      },
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
        agentDocumentId: args.id,
        agentId,
        documentId: updated.documentId ?? existing.documentId,
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

    // Pre-read the backing `documents` row id so the deleted document's Work can
    // be located from `state` after the row is gone. Mirrors the replace / rename
    // / modify pre-read and keeps the total query count flat (the server service
    // impl previously ran this lookup imperatively for the delete registration).
    const existing = await this.service.readDocument({ agentId, id: args.id });
    if (!existing) return { content: `Document not found: ${args.id}`, success: false };

    const deleted = await this.service.removeDocument({
      ...args,
      ...this.buildToolTriggerInput(context),
      agentId,
    });
    if (!deleted) return { content: `Document not found: ${args.id}`, success: false };

    return {
      content: formatRemoveDocumentResult({ id: args.id }),
      state: {
        agentDocumentId: args.id,
        agentId,
        deleted: true,
        documentId: existing.documentId,
        id: args.id,
      },
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
      state: {
        agentDocumentId: args.id,
        agentId,
        documentId: doc.documentId ?? existing.documentId,
        id: args.id,
        newTitle: args.newTitle,
        renamed: true,
      },
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
      state: {
        agentDocumentId: copied.id,
        agentId,
        copiedFromId: args.id,
        documentId: copied.documentId,
        newDocumentId: copied.id,
      },
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
