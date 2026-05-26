import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  PageAgentExecutionRuntime,
  type PageAgentInvocationContext,
  type PageAgentRuntimeService,
} from '@lobechat/builtin-tool-page-agent/executionRuntime';
import { EditorRuntime, type LiteXMLAdapter } from '@lobechat/editor-runtime';
import { createHeadlessEditor, type HeadlessEditor } from '@lobehub/editor/headless';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

import { DocumentModel } from '@/database/models/document';
import { type LobeChatDatabase } from '@/database/type';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { DocumentService } from '@/server/services/document';

import type { ServerRuntimeRegistration } from './types';

type SerializedEditor = SerializedEditorState<SerializedLexicalNode>;

type EditorRuntimeEditorParam = Parameters<EditorRuntime['setEditor']>[0];

interface DocumentSnapshot {
  content: string;
  editorData: Record<string, unknown> | null;
  title: string;
}

interface InvocationEnv {
  getTitle: () => string;
  headless: HeadlessEditor;
  runtime: EditorRuntime;
  setTitle: (title: string) => void;
  snapshot: DocumentSnapshot;
}

/**
 * Cheap, dependency-free fingerprint used only to detect whether a mutation
 * actually changed the document body. Collisions are tolerated — at worst we
 * miss a silent-failure warning; we never lose persistence.
 */
const hashEditorData = (data: unknown): string => {
  const json = JSON.stringify(data ?? null);
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 33) ^ json.charCodeAt(i);
  }
  return `${json.length}:${(hash >>> 0).toString(16)}`;
};

interface InvariantFlags {
  editorChanged: boolean;
  handlerReportedChange: boolean;
  titleChanged: boolean;
}

interface InvariantViolation {
  apiName: string;
  detail: string;
  kind: 'silent-no-op' | 'unexpected-mutation';
}

const detectHandlerReportedChange = (apiName: string, state: Record<string, unknown>): boolean => {
  switch (apiName) {
    case 'modifyNodes': {
      const successCount = state.successCount;
      return typeof successCount === 'number' && successCount > 0;
    }
    case 'replaceText': {
      const count = state.replacementCount;
      return typeof count === 'number' && count > 0;
    }
    case 'initPage': {
      const nodeCount = state.nodeCount;
      return typeof nodeCount === 'number' && nodeCount > 0;
    }
    default: {
      return false;
    }
  }
};

const detectInvariantViolation = (
  apiName: string,
  flags: InvariantFlags,
): InvariantViolation | undefined => {
  // editTitle is exempt: title lives outside editorData, so editorChanged is
  // expected to be false.
  if (apiName === 'editTitle') return undefined;

  if (flags.handlerReportedChange && !flags.editorChanged && !flags.titleChanged) {
    return {
      apiName,
      detail: 'Handler reported successful mutation but exported editorData hash did not change.',
      kind: 'silent-no-op',
    };
  }

  if (!flags.handlerReportedChange && flags.editorChanged) {
    return {
      apiName,
      detail: 'Editor state changed even though handler did not report any successful change.',
      kind: 'unexpected-mutation',
    };
  }

  return undefined;
};

interface PageAgentServiceContext {
  documentModel: DocumentModel;
  documentService: DocumentService;
}

const loadSnapshot = async (
  documentModel: DocumentModel,
  documentId: string,
): Promise<DocumentSnapshot> => {
  const doc = await documentModel.findById(documentId);
  if (!doc) {
    throw new Error(`Page document not found: ${documentId}`);
  }
  return {
    content: doc.content ?? '',
    editorData: (doc.editorData ?? null) as Record<string, unknown> | null,
    title: doc.title ?? 'Untitled',
  };
};

const buildEnv = (snapshot: DocumentSnapshot, documentId: string): InvocationEnv => {
  const headless = createHeadlessEditor();
  let title = snapshot.title;

  if (isValidEditorData(snapshot.editorData)) {
    headless.hydrateEditorData(snapshot.editorData as unknown as SerializedEditor, {
      keepId: true,
    });
  } else if (snapshot.content.trim().length > 0) {
    headless.hydrateMarkdown(snapshot.content, { keepId: true });
  }
  // Otherwise leave the headless editor in its default empty state.

  const runtime = new EditorRuntime();
  // `headless.kernel` is structurally `IEditor`; pnpm may resolve `@lobehub/editor`
  // to a different copy here than `@lobechat/editor-runtime` does, making the two
  // `IEditor` types nominally distinct. They are runtime-identical — bridge via
  // unknown to keep the contract explicit.
  runtime.setEditor(headless.kernel as unknown as EditorRuntimeEditorParam);
  runtime.setCurrentDocId(documentId);
  // Route LiteXML mutations through the HeadlessEditor wrapper so the right
  // command symbols (registered inside the headless bundle) are dispatched.
  // Going through `kernel.dispatchCommand(LITEXML_*_COMMAND, ...)` with the
  // symbols imported from `@lobehub/editor` would no-op silently — different
  // module copies create different command identities.
  const headlessAdapter: LiteXMLAdapter = {
    applyBatch: async (_editor, operations) => {
      await headless.applyLiteXMLBatch(operations);
    },
    applyReplace: async (_editor, litexml) => {
      await headless.applyLiteXML({ action: 'apply', litexml });
    },
  };
  runtime.setLiteXMLAdapter(headlessAdapter);
  runtime.setTitleHandlers(
    (next) => {
      title = next;
    },
    () => title,
  );

  return {
    getTitle: () => title,
    headless,
    runtime,
    setTitle: (next) => {
      title = next;
    },
    snapshot,
  };
};

interface WithEditorOptions {
  exportEditorData?: boolean;
  /** Whether to enforce silent-failure invariant checks on this invocation. */
  invariantCheck?: boolean;
  /** Whether to persist any captured patch back to the document row. */
  persist?: boolean;
}

interface HandlerOutput {
  content: string;
  state: Record<string, unknown>;
}

const withEditor = async (
  { documentModel, documentService }: PageAgentServiceContext,
  apiName: string,
  ctx: PageAgentInvocationContext,
  handler: (env: InvocationEnv) => Promise<HandlerOutput>,
  options: WithEditorOptions = {},
): Promise<HandlerOutput> => {
  const documentId = ctx.documentId;
  // The runtime shell already rejected missing documentId; this guard is for
  // type-narrowing only.
  if (!documentId) {
    throw new Error('documentId is required');
  }

  const snapshot = await loadSnapshot(documentModel, documentId);
  const env = buildEnv(snapshot, documentId);
  const exportEditorData = options.exportEditorData !== false;
  const persist = options.persist !== false;
  const invariantCheck = options.invariantCheck !== false;

  try {
    const beforeHash = exportEditorData
      ? hashEditorData(env.headless.export().editorData)
      : undefined;

    const handlerResult = await handler(env);

    const exported = exportEditorData ? env.headless.export() : undefined;
    const afterHash = exported ? hashEditorData(exported.editorData) : undefined;
    const titleChanged = env.getTitle() !== snapshot.title;
    const editorChanged = exportEditorData && beforeHash !== undefined && beforeHash !== afterHash;

    const invariantViolation = invariantCheck
      ? detectInvariantViolation(apiName, {
          editorChanged,
          handlerReportedChange: detectHandlerReportedChange(apiName, handlerResult.state),
          titleChanged,
        })
      : undefined;

    if (invariantViolation) {
      console.warn(
        `[PageAgentServerRuntime] invariant violation in ${apiName}:`,
        invariantViolation,
        { documentId, operationId: ctx.operationId, toolCallId: ctx.toolCallId },
      );
    }

    const patch: {
      content?: string;
      editorData?: Record<string, unknown>;
      title?: string;
    } = {};
    if (exported) {
      patch.content = exported.markdown;
      patch.editorData = exported.editorData as unknown as Record<string, unknown>;
    }
    if (titleChanged) {
      patch.title = env.getTitle();
    }

    if (persist && Object.keys(patch).length > 0) {
      await documentService.updateDocument(documentId, {
        content: patch.content,
        editorData: patch.editorData,
        saveSource: 'llm_call',
        title: patch.title,
      });
    }

    return {
      content: handlerResult.content,
      state: {
        ...handlerResult.state,
        documentContent: patch.content,
        documentEditorData: patch.editorData,
        documentTitle: env.getTitle(),
        ...(invariantViolation ? { invariantViolation } : {}),
      },
    };
  } finally {
    env.headless.destroy();
  }
};

const buildService = (db: LobeChatDatabase, userId: string): PageAgentRuntimeService => {
  const documentModel = new DocumentModel(db, userId);
  const documentService = new DocumentService(db, userId);
  const serviceCtx: PageAgentServiceContext = { documentModel, documentService };

  return {
    editTitle: (args, ctx) =>
      withEditor(
        serviceCtx,
        'editTitle',
        ctx,
        async ({ runtime }) => {
          const result = await runtime.editTitle(args);
          return {
            content: `Title changed from "${result.previousTitle}" to "${result.newTitle}".`,
            state: { newTitle: result.newTitle, previousTitle: result.previousTitle },
          };
        },
        { exportEditorData: false },
      ),

    getPageContent: (args, ctx) =>
      withEditor(
        serviceCtx,
        'getPageContent',
        ctx,
        async ({ runtime, getTitle }) => {
          const result = await runtime.getPageContent(args);
          return {
            content: result.markdown || result.xml || '',
            state: {
              markdown: result.markdown,
              metadata: {
                fileType: 'document',
                title: getTitle(),
                totalCharCount: result.charCount,
                totalLineCount: result.lineCount,
              },
              xml: result.xml,
            },
          };
        },
        { persist: false },
      ),

    initPage: (args, ctx) =>
      withEditor(serviceCtx, 'initPage', ctx, async ({ runtime }) => {
        const result = await runtime.initPage(args);
        return {
          content: result.extractedTitle
            ? `Document initialized with ${result.nodeCount} nodes. Title "${result.extractedTitle}" extracted and set.`
            : `Document initialized with ${result.nodeCount} nodes.`,
          state: {
            extractedTitle: result.extractedTitle,
            nodeCount: result.nodeCount,
            rootId: 'root',
          },
        };
      }),

    modifyNodes: (args, ctx) =>
      withEditor(serviceCtx, 'modifyNodes', ctx, async ({ runtime }) => {
        const result = await runtime.modifyNodes(args);
        const operations = Array.isArray(args.operations)
          ? args.operations
          : args.operations
            ? [args.operations]
            : [];
        const actionSummary = operations.reduce<Record<string, number>>((acc, op) => {
          if (!op) return acc;
          acc[op.action] = (acc[op.action] || 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(actionSummary)
          .map(([action, count]) => `${count} ${action}${count > 1 ? 's' : ''}`)
          .join(', ');
        return {
          content: `Successfully executed ${summary} (${result.successCount}/${result.totalCount} operations succeeded).`,
          state: {
            results: result.results,
            successCount: result.successCount,
            totalCount: result.totalCount,
          },
        };
      }),

    replaceText: (args, ctx) =>
      withEditor(serviceCtx, 'replaceText', ctx, async ({ runtime }) => {
        const result = await runtime.replaceText(args);
        const scope = args.nodeIds?.length
          ? `within ${args.nodeIds.length} specified node(s)`
          : 'across the document';
        const content =
          result.replacementCount > 0
            ? `Successfully replaced ${result.replacementCount} occurrence(s) of "${args.searchText}" with "${args.newText}" ${scope}. Modified ${result.modifiedNodeIds.length} node(s).`
            : `No occurrences of "${args.searchText}" found ${scope}.`;
        return {
          content,
          state: {
            modifiedNodeIds: result.modifiedNodeIds,
            replacementCount: result.replacementCount,
          },
        };
      }),
  };
};

/**
 * Registers the page-agent builtin server runtime.
 *
 * Each tool invocation:
 *   1. loads the `documents` row,
 *   2. hydrates a `@lobehub/editor` HeadlessEditor from `editorData`/`content`,
 *   3. runs the requested page-agent API via the shared `EditorRuntime`,
 *   4. exports the new Lexical state and writes it back via
 *      `DocumentService.updateDocument` (saveSource: 'llm_call' → also appends
 *      a `documentHistories` snapshot).
 *
 * The renderer's `PageAgentExecutor.onAfterCall` consumes the returned
 * `result.state.document*` fields to apply the new editorData to the live
 * Lexical editor and reconcile the document store.
 */
export const pageAgentRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Page Agent execution');
    }
    return new PageAgentExecutionRuntime(buildService(context.serverDB, context.userId));
  },
  identifier: PageAgentIdentifier,
};
