import type {
  EditorRuntime,
  EditTitleArgs,
  GetPageContentArgs,
  InitDocumentArgs,
  ModifyNodesArgs,
  ReplaceTextArgs,
} from '@lobechat/editor-runtime';
import type { BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import type {
  EditTitleState,
  GetPageContentState,
  InitDocumentState,
  ModifyNodesState,
  ReplaceTextState,
} from '../types';
import { PageAgentIdentifier } from '../types';

const log = debug('lobe-page-agent:executor');

/**
 * API enum for Page Agent executor
 * Only includes APIs that are exposed in the manifest
 */
const PageAgentApiName = {
  // Document Metadata
  editTitle: 'editTitle',

  // Query & Read
  getPageContent: 'getPageContent',

  // Initialize
  initPage: 'initPage',

  // Unified Node Operations
  modifyNodes: 'modifyNodes',

  // Text Operations
  replaceText: 'replaceText',
} as const;

const summarizeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return { message: String(error) };
};

const getRuntimeDebugSnapshot = (runtime: EditorRuntime) => {
  const candidate = runtime as EditorRuntime & {
    getDebugSnapshot?: () => unknown;
  };

  return candidate.getDebugSnapshot?.();
};

const PAGE_EDITOR_NOT_MOUNTED_MESSAGE =
  'Page editor is not currently mounted. This topic was started in the page editor, but the editor is not active in the current view. ' +
  'Do not retry initPage / editTitle / modifyNodes / replaceText / getPageContent here — they require a mounted editor. ' +
  'To read or modify the topic document, use lobe-agent-documents (readDocument / editDocument / modifyNodes / upsertDocumentByFilename).';

const buildEditorNotMountedResult = (
  runtime: EditorRuntime,
  apiName: string,
): BuiltinToolResult => ({
  content: PAGE_EDITOR_NOT_MOUNTED_MESSAGE,
  error: {
    body: {
      apiName,
      code: 'PAGE_EDITOR_NOT_MOUNTED',
      kind: 'replan',
      runtime: getRuntimeDebugSnapshot(runtime),
    },
    message: PAGE_EDITOR_NOT_MOUNTED_MESSAGE,
    type: 'PageEditorNotMounted',
  },
  success: false,
});

/**
 * Page Agent Executor
 *
 * Wraps the EditorRuntime to provide a unified executor interface
 * that follows the BaseExecutor pattern used by other builtin tools.
 *
 * Note: Page Agent is a client-side tool that directly manipulates the Lexical editor.
 * The runtime must be configured with an editor instance before use.
 */
class PageAgentExecutor extends BaseExecutor<typeof PageAgentApiName> {
  readonly identifier = PageAgentIdentifier;
  protected readonly apiEnum = PageAgentApiName;

  /**
   * The execution runtime instance
   * This is a singleton that should be configured with an editor instance externally
   */
  private runtime: EditorRuntime;

  constructor(runtime: EditorRuntime) {
    super();
    this.runtime = runtime;

    // scope is topic-bound, not route-bound: navigating away from the page
    // editor keeps scope==='page' on the same topic, so without this guard
    // the LLM can still call page-agent APIs against a stale editor ref.
    const baseInvoke = this.invoke;
    this.invoke = async (apiName, params, ctx) => {
      if (this.hasApi(apiName) && !this.runtime.isReady()) {
        console.warn('[PageAgentToolCall] blocked: editor not mounted', {
          apiName,
          runtime: getRuntimeDebugSnapshot(this.runtime),
        });
        return buildEditorNotMountedResult(this.runtime, apiName);
      }

      return baseInvoke(apiName, params, ctx);
    };
  }

  // ==================== Initialize ====================

  /**
   * Initialize a new document from Markdown content
   */
  initPage = async (params: InitDocumentArgs): Promise<BuiltinToolResult> => {
    log('[PageAgentToolCall] initPage:start', {
      markdownLength: params.markdown.length,
      runtime: getRuntimeDebugSnapshot(this.runtime),
    });

    try {
      const result = await this.runtime.initPage(params);

      const content = result.extractedTitle
        ? `Document initialized with ${result.nodeCount} nodes. Title "${result.extractedTitle}" extracted and set.`
        : `Document initialized with ${result.nodeCount} nodes.`;

      const state: InitDocumentState = {
        nodeCount: result.nodeCount,
        rootId: 'root',
      };

      log('[PageAgentToolCall] initPage:success', {
        nodeCount: result.nodeCount,
        runtime: getRuntimeDebugSnapshot(this.runtime),
        titleExtracted: !!result.extractedTitle,
      });

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
      console.error('[PageAgentToolCall] initPage:error', {
        error: summarizeError(error),
        runtime: getRuntimeDebugSnapshot(this.runtime),
      });

      return {
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  // ==================== Document Metadata ====================

  /**
   * Edit the page title
   */
  editTitle = async (params: EditTitleArgs): Promise<BuiltinToolResult> => {
    log('[PageAgentToolCall] editTitle:start', {
      runtime: getRuntimeDebugSnapshot(this.runtime),
      titleLength: params.title.length,
    });

    try {
      const result = await this.runtime.editTitle(params);

      const content = `Title changed from "${result.previousTitle}" to "${result.newTitle}".`;

      const state: EditTitleState = {
        newTitle: result.newTitle,
        previousTitle: result.previousTitle,
      };

      log('[PageAgentToolCall] editTitle:success', {
        runtime: getRuntimeDebugSnapshot(this.runtime),
        titleLength: params.title.length,
      });

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
      console.error('[PageAgentToolCall] editTitle:error', {
        error: summarizeError(error),
        runtime: getRuntimeDebugSnapshot(this.runtime),
      });

      return {
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  // ==================== Query & Read ====================

  /**
   * Get page content in XML, markdown, or both formats
   */
  getPageContent = async (params: GetPageContentArgs): Promise<BuiltinToolResult> => {
    log('[PageAgentToolCall] getPageContent:start', {
      format: params.format,
      runtime: getRuntimeDebugSnapshot(this.runtime),
    });

    try {
      const result = await this.runtime.getPageContent(params);

      const state: GetPageContentState = {
        documentId: result.documentId,
        markdown: result.markdown,
        metadata: {
          fileType: 'document',
          title: result.title,
          totalCharCount: result.charCount,
          totalLineCount: result.lineCount,
        },
        xml: result.xml,
      };

      // For getPageContent, the content IS the document content
      // We return the formatted content based on the requested format
      const content = result.markdown || result.xml || '';

      log('[PageAgentToolCall] getPageContent:success', {
        format: params.format,
        markdownLength: result.markdown?.length,
        runtime: getRuntimeDebugSnapshot(this.runtime),
        xmlLength: result.xml?.length,
      });

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
      console.error('[PageAgentToolCall] getPageContent:error', {
        error: summarizeError(error),
        runtime: getRuntimeDebugSnapshot(this.runtime),
      });

      return {
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  // ==================== Unified Node Operations ====================

  /**
   * Perform unified node operations (insert, modify, remove)
   */
  modifyNodes = async (params: ModifyNodesArgs): Promise<BuiltinToolResult> => {
    const operations = Array.isArray(params.operations)
      ? params.operations
      : params.operations
        ? [params.operations]
        : [];

    log('[PageAgentToolCall] modifyNodes:start', {
      operationActions: operations.map((op) => op.action),
      operationCount: operations.length,
      runtime: getRuntimeDebugSnapshot(this.runtime),
    });

    try {
      const result = await this.runtime.modifyNodes(params);

      // Build summary message
      const actionSummary = params.operations.reduce(
        (acc, op) => {
          acc[op.action] = (acc[op.action] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const summaryParts = Object.entries(actionSummary).map(
        ([action, count]) => `${count} ${action}${count > 1 ? 's' : ''}`,
      );
      const content = `Successfully executed ${summaryParts.join(', ')} (${result.successCount}/${result.totalCount} operations succeeded).`;

      const state: ModifyNodesState = {
        results: result.results,
        successCount: result.successCount,
        totalCount: result.totalCount,
      };

      log('[PageAgentToolCall] modifyNodes:success', {
        runtime: getRuntimeDebugSnapshot(this.runtime),
        successCount: result.successCount,
        totalCount: result.totalCount,
      });

      return { content, state, success: result.successCount > 0 };
    } catch (error) {
      const err = error as Error;
      console.error('[PageAgentToolCall] modifyNodes:error', {
        error: summarizeError(error),
        runtime: getRuntimeDebugSnapshot(this.runtime),
      });

      return {
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  // ==================== Text Operations ====================

  /**
   * Find and replace text across the document
   */
  replaceText = async (params: ReplaceTextArgs): Promise<BuiltinToolResult> => {
    log('[PageAgentToolCall] replaceText:start', {
      newTextLength: params.newText.length,
      nodeCount: params.nodeIds?.length,
      runtime: getRuntimeDebugSnapshot(this.runtime),
      searchTextLength: params.searchText.length,
    });

    try {
      const result = await this.runtime.replaceText(params);

      // Build response message
      const scopeDescription = params.nodeIds
        ? `within ${params.nodeIds.length} specified node(s)`
        : 'across the document';

      const content =
        result.replacementCount > 0
          ? `Successfully replaced ${result.replacementCount} occurrence(s) of "${params.searchText}" with "${params.newText}" ${scopeDescription}. Modified ${result.modifiedNodeIds.length} node(s).`
          : `No occurrences of "${params.searchText}" found ${scopeDescription}.`;

      const state: ReplaceTextState = {
        modifiedNodeIds: result.modifiedNodeIds,
        replacementCount: result.replacementCount,
      };

      log('[PageAgentToolCall] replaceText:success', {
        modifiedNodeCount: result.modifiedNodeIds.length,
        replacementCount: result.replacementCount,
        runtime: getRuntimeDebugSnapshot(this.runtime),
      });

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
      console.error('[PageAgentToolCall] replaceText:error', {
        error: summarizeError(error),
        runtime: getRuntimeDebugSnapshot(this.runtime),
      });

      return {
        error: {
          body: error,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };
}

// Export the executor class and a factory function
export { PageAgentExecutor };
