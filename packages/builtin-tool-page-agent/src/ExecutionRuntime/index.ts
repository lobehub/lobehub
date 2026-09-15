import type {
  EditTitleArgs,
  GetPageContentArgs,
  InitDocumentArgs,
  ModifyNodesArgs,
  ReplaceTextArgs,
} from '@lobechat/editor-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { RewriteSelectionArgs } from '../types';

/**
 * Context passed to every page-agent server invocation.
 *
 * Mirrors the subset of `BuiltinToolContext` the page-agent tools rely on.
 * Kept minimal so this package does not depend on `@lobechat/types`'
 * full context shape (which carries renderer-only fields). Every
 * `scope: 'page'` call is collaboration-owned: legacy body APIs are rejected
 * before a DB-backed service can claim success without writing the live Yjs
 * room. Personal Page calls intentionally have no workspaceId, so scope—not
 * workspace membership—is the routing boundary.
 */
export interface PageAgentInvocationContext {
  /** Agent whose conversation issued the tool call. */
  agentId?: string;
  documentId?: string | null;
  operationId?: string;
  /** Conversation scope captured on the operation, if any. */
  scope?: string | null;
  stepIndex?: number;
  toolCallId?: string;
  userId?: string;
  /** Workspace scope captured on the operation, if any. */
  workspaceId?: string | null;
}

/**
 * Shape every page-agent API callback must return. The runtime shell wraps
 * this into a `BuiltinServerRuntimeOutput` (filling `success: true`, adding
 * `documentId` to the state envelope, attaching error metadata on throw).
 */
export interface PageAgentApiOutput {
  content: string;
  state?: Record<string, unknown>;
}

/**
 * Service contract that host code (server runtime registration) implements.
 *
 * Implementations are expected to:
 *   1. Load the document row identified by `ctx.documentId`.
 *   2. Run the requested mutation against a `HeadlessEditor` + `EditorRuntime`
 *      pair (page-agent tools always operate on a single document).
 *   3. Persist the new editorData/content/title back through `DocumentService`
 *      for non-collaborative calls. Workspace Page body mutations are rejected
 *      by the runtime shell; the room worker owns their Yjs write/ack path.
 *   4. Return both a human-readable `content` string and a `state` object
 *      with at least `documentEditorData` / `documentContent` /
 *      `documentTitle` so the renderer's `onAfterCall` hook can apply the
 *      patch to the live Lexical editor without an extra DB roundtrip.
 *
 * Keeping the contract here (and the implementation at the registration site)
 * avoids dragging `@lobehub/editor` / `@lobechat/editor-runtime` into this
 * package's static import graph.
 */
export interface PageAgentRuntimeService {
  editTitle: (args: EditTitleArgs, ctx: PageAgentInvocationContext) => Promise<PageAgentApiOutput>;
  getPageContent: (
    args: GetPageContentArgs,
    ctx: PageAgentInvocationContext,
  ) => Promise<PageAgentApiOutput>;
  initPage: (
    args: InitDocumentArgs,
    ctx: PageAgentInvocationContext,
  ) => Promise<PageAgentApiOutput>;
  modifyNodes: (
    args: ModifyNodesArgs,
    ctx: PageAgentInvocationContext,
  ) => Promise<PageAgentApiOutput>;
  replaceText: (
    args: ReplaceTextArgs,
    ctx: PageAgentInvocationContext,
  ) => Promise<PageAgentApiOutput>;
  /**
   * Drive an already-created durable collaborative rewrite request. This tool
   * intentionally does not accept selection anchors, room tickets, snapshots,
   * or editor mutation payloads.
   */
  rewriteSelection: (
    args: RewriteSelectionArgs,
    ctx: PageAgentInvocationContext,
  ) => Promise<PageAgentApiOutput>;
}

const MISSING_DOCUMENT_ID =
  'PageAgent server runtime received a tool call without documentId in context. ' +
  'The conversation must be scoped to an open page editor.';

const COLLABORATIVE_BODY_APIS = new Set(['initPage', 'modifyNodes', 'replaceText']);
const COLLABORATIVE_BODY_MESSAGE =
  'The Page body is owned by the live collaboration room. Use the existing rewriteSelection request bridge for collaborative body changes.';

const failure = (message: string, type: string, body?: unknown): BuiltinServerRuntimeOutput => ({
  content: message,
  error: { body, message, type } as unknown,
  success: false,
});

/**
 * Server-side page-agent execution runtime.
 *
 * The runtime is a thin shell:
 *   - validates `documentId` is present
 *   - forwards to the host-supplied {@link PageAgentRuntimeService}
 *   - normalizes success / failure into {@link BuiltinServerRuntimeOutput}
 *
 * All editor wiring (HeadlessEditor hydration, EditorRuntime invocation,
 * exports, persistence, silent-failure detection) lives in the consumer of
 * this class — see `src/server/services/toolExecution/serverRuntimes/pageAgent.ts`.
 */
export class PageAgentExecutionRuntime {
  private service: PageAgentRuntimeService;

  constructor(service: PageAgentRuntimeService) {
    this.service = service;
  }

  initPage = (args: InitDocumentArgs, ctx: PageAgentInvocationContext) =>
    this.dispatch('initPage', ctx, () => this.service.initPage(args, ctx));

  editTitle = (args: EditTitleArgs, ctx: PageAgentInvocationContext) =>
    this.dispatch('editTitle', ctx, () => this.service.editTitle(args, ctx));

  getPageContent = (args: GetPageContentArgs, ctx: PageAgentInvocationContext) =>
    this.dispatch('getPageContent', ctx, () => this.service.getPageContent(args, ctx));

  modifyNodes = (args: ModifyNodesArgs, ctx: PageAgentInvocationContext) =>
    this.dispatch('modifyNodes', ctx, () => this.service.modifyNodes(args, ctx));

  replaceText = (args: ReplaceTextArgs, ctx: PageAgentInvocationContext) =>
    this.dispatch('replaceText', ctx, () => this.service.replaceText(args, ctx));

  rewriteSelection = (args: RewriteSelectionArgs, ctx: PageAgentInvocationContext) =>
    this.dispatch('rewriteSelection', ctx, () => this.service.rewriteSelection(args, ctx));

  private async dispatch(
    apiName: string,
    ctx: PageAgentInvocationContext,
    invoke: () => Promise<PageAgentApiOutput>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!ctx.documentId) {
      return failure(MISSING_DOCUMENT_ID, 'PageAgentMissingDocumentId');
    }

    // Every Page run is backed by the live collaboration room. Legacy
    // headless DB mutations would report success while leaving the Yjs room
    // unchanged, so fail closed at the server boundary. Metadata, reads, and
    // the durable rewrite-selection bridge remain available. Do not infer this
    // from workspaceId: personal Page contexts also carry scope='page'.
    if (ctx.scope === 'page' && COLLABORATIVE_BODY_APIS.has(apiName)) {
      return failure(COLLABORATIVE_BODY_MESSAGE, 'PageAgentCollaborationBodyOwned');
    }

    try {
      const output = await invoke();
      return {
        content: output.content,
        state: { documentId: ctx.documentId, ...output.state },
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      console.error(`[PageAgentExecutionRuntime] ${apiName} error`, err);
      return failure(err.message, 'PageAgentRuntimeError', err);
    }
  }
}
