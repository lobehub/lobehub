import type {
  EditTitleArgs,
  GetPageContentArgs,
  InitDocumentArgs,
  ModifyNodesArgs,
  ReplaceTextArgs,
} from '@lobechat/editor-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

/**
 * Context passed to every page-agent server invocation.
 *
 * Mirrors the subset of `BuiltinToolContext` the page-agent tools rely on.
 * Kept minimal so this package does not depend on `@lobechat/types`'
 * full context shape (which carries renderer-only fields).
 */
export interface PageAgentInvocationContext {
  documentId?: string | null;
  operationId?: string;
  stepIndex?: number;
  toolCallId?: string;
  userId?: string;
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
 *   3. Persist the new editorData/content/title back through `DocumentService`.
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
}

const MISSING_DOCUMENT_ID =
  'PageAgent server runtime received a tool call without documentId in context. ' +
  'The conversation must be scoped to an open page editor.';

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

  private async dispatch(
    apiName: string,
    ctx: PageAgentInvocationContext,
    invoke: () => Promise<PageAgentApiOutput>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!ctx.documentId) {
      return failure(MISSING_DOCUMENT_ID, 'PageAgentMissingDocumentId');
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
