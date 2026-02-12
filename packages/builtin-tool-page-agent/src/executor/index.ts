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

import type {
  EditTitleState,
  GetPageContentState,
  InitDocumentState,
  ModifyNodesState,
  ReplaceTextState,
} from '../types';
import { PageAgentIdentifier } from '../types';

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
  }

  // ==================== Initialize ====================

  /**
   * Initialize a new document from Markdown content
   */
  initPage = async (params: InitDocumentArgs): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.initPage(params);

      const content = result.extractedTitle
        ? `Document initialized with ${result.nodeCount} nodes. Title "${result.extractedTitle}" extracted and set.`
        : `Document initialized with ${result.nodeCount} nodes.`;

      const state: InitDocumentState = {
        nodeCount: result.nodeCount,
        rootId: 'root',
      };

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
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
    try {
      const result = await this.runtime.editTitle(params);

      const content = `Title changed from "${result.previousTitle}" to "${result.newTitle}".`;

      const state: EditTitleState = {
        newTitle: result.newTitle,
        previousTitle: result.previousTitle,
      };

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
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

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
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

      return { content, state, success: result.successCount > 0 };
    } catch (error) {
      const err = error as Error;
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

      return { content, state, success: true };
    } catch (error) {
      const err = error as Error;
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
