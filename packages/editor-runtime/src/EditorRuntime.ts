import type { PageContentContext } from '@lobechat/prompts';
import type { IEditor } from '@lobehub/editor';
import { LITEXML_APPLY_COMMAND, LITEXML_MODIFY_COMMAND } from '@lobehub/editor';
import debug from 'debug';

import type {
  EditTitleArgs,
  EditTitleRuntimeResult,
  GetPageContentArgs,
  GetPageContentRuntimeResult,
  InitDocumentArgs,
  InitPageRuntimeResult,
  ModifyNodesArgs,
  ModifyNodesRuntimeResult,
  ModifyOperationResult,
  ReplaceTextArgs,
  ReplaceTextRuntimeResult,
} from './types';

const log = debug('lobe:editor-runtime');

interface InspectableEditor {
  dataTypeMap?: Map<string, unknown> | Record<string, unknown>;
  editor?: unknown;
  getLexicalEditor?: () => unknown | null;
  plugins?: unknown[];
  pluginsInstances?: unknown[];
}

export interface EditorRuntimeDebugSnapshot {
  currentDocId?: string;
  dataSourceTypes: string[];
  hasBeforeMutateHandler: boolean;
  hasEditor: boolean;
  hasLexicalEditor: boolean;
  hasTitleGetter: boolean;
  hasTitleSetter: boolean;
  pluginCount?: number;
  pluginInstanceCount?: number;
}

const getDataSourceTypes = (editor: InspectableEditor): string[] => {
  const dataTypeMap = editor.dataTypeMap;
  if (!dataTypeMap) return [];

  if (dataTypeMap instanceof Map) {
    return [...dataTypeMap.keys()].sort();
  }

  return Object.keys(dataTypeMap).sort();
};

/**
 * Editor Execution Runtime
 * Handles the execution logic for editor operations including:
 * - Document initialization
 * - Title management
 * - Content retrieval
 * - Node modifications (insert, modify, remove)
 * - Text replacement
 */
export class EditorRuntime {
  private editor: IEditor | null = null;
  private titleSetter: ((title: string) => void) | null = null;
  private titleGetter: (() => string) | null = null;
  private currentDocId: string | undefined = undefined;
  private beforeMutateHandler: (() => void | Promise<void>) | null = null;

  /**
   * Set the current editor instance
   */
  setEditor(editor: IEditor | null) {
    this.editor = editor;
    log('[EditorRuntime] setEditor', this.getDebugSnapshot());
  }

  /**
   * Set the current document ID
   */
  setCurrentDocId(docId: string | undefined) {
    log('Setting current doc ID:', docId);
    this.currentDocId = docId;
    log('[EditorRuntime] setCurrentDocId', this.getDebugSnapshot());
  }

  /**
   * Get the current document ID
   */
  getCurrentDocId(): string | undefined {
    return this.currentDocId;
  }

  /**
   * Set a handler to be called before any mutating operation.
   * This can be used to save history or perform other pre-mutation tasks.
   */
  setBeforeMutateHandler(handler: (() => void | Promise<void>) | null) {
    this.beforeMutateHandler = handler;
    log('[EditorRuntime] setBeforeMutateHandler', this.getDebugSnapshot());
  }

  /**
   * Set the title setter and getter functions
   */
  setTitleHandlers(setter: ((title: string) => void) | null, getter: (() => string) | null) {
    this.titleSetter = setter;
    this.titleGetter = getter;
    log('[EditorRuntime] setTitleHandlers', this.getDebugSnapshot());
  }

  /**
   * Lightweight runtime snapshot for page-agent tool call diagnostics.
   * This intentionally avoids reading document content.
   */
  getDebugSnapshot(): EditorRuntimeDebugSnapshot {
    const inspectableEditor = this.editor as InspectableEditor | null;
    const hasLexicalEditor = (() => {
      try {
        return !!inspectableEditor?.getLexicalEditor?.();
      } catch {
        return false;
      }
    })();

    return {
      currentDocId: this.currentDocId,
      dataSourceTypes: inspectableEditor ? getDataSourceTypes(inspectableEditor) : [],
      hasBeforeMutateHandler: !!this.beforeMutateHandler,
      hasEditor: !!this.editor,
      hasLexicalEditor,
      hasTitleGetter: !!this.titleGetter,
      hasTitleSetter: !!this.titleSetter,
      pluginCount: inspectableEditor?.plugins?.length,
      pluginInstanceCount: inspectableEditor?.pluginsInstances?.length,
    };
  }

  isReady(): boolean {
    if (!this.editor) return false;

    const inspectableEditor = this.editor as InspectableEditor;
    try {
      return !!inspectableEditor.getLexicalEditor?.();
    } catch {
      return false;
    }
  }

  /**
   * Get the current editor instance
   */
  private getEditor(): IEditor {
    if (!this.editor) {
      throw new Error('Editor not initialized. Please set the editor instance first.');
    }
    return this.editor;
  }

  /**
   * Get the title handlers
   */
  private getTitleHandlers(): { getter: () => string; setter: (title: string) => void } {
    if (!this.titleSetter || !this.titleGetter) {
      throw new Error('Title handlers not initialized. Please set the title handlers first.');
    }
    return { getter: this.titleGetter, setter: this.titleSetter };
  }

  // ==================== Initialize ====================

  /**
   * Initialize document from Markdown content
   * @returns Raw result with nodeCount and extractedTitle
   */
  async initPage(args: InitDocumentArgs): Promise<InitPageRuntimeResult> {
    log('[EditorRuntime] initPage:start', {
      markdownLength: args.markdown.length,
      snapshot: this.getDebugSnapshot(),
    });

    try {
      await this.beforeMutateHandler?.();
    } catch {
      /* ignore pre-mutation errors */
    }
    const editor = this.getEditor();

    let markdown = args.markdown;
    let extractedTitle: string | undefined;

    // Check if markdown starts with a # title heading
    if (markdown.startsWith('# ')) {
      const endOfLine = markdown.search(/\r?\n/);
      const titleLine = endOfLine === -1 ? markdown : markdown.slice(0, endOfLine);
      extractedTitle = titleLine.slice(2).trim();
      // Remove the title line from markdown
      markdown = markdown.slice(titleLine.length).trimStart();

      // Set the title separately if title handlers are available
      if (this.titleSetter) {
        this.titleSetter(extractedTitle);
      }
    }

    // Set markdown content directly - the editor will convert it internally
    editor.setDocument('markdown', markdown, { keepId: true });

    // Get the resulting document to count nodes
    const jsonState = editor.getDocument('json') as any;
    const nodeCount = jsonState?.children?.length || 0;

    const result = { extractedTitle, nodeCount };
    log('[EditorRuntime] initPage:success', {
      nodeCount,
      snapshot: this.getDebugSnapshot(),
      titleExtracted: !!extractedTitle,
    });

    return result;
  }

  // ==================== Metadata ====================

  /**
   * Edit the page title
   * @returns Raw result with newTitle and previousTitle
   */
  async editTitle(args: EditTitleArgs): Promise<EditTitleRuntimeResult> {
    log('[EditorRuntime] editTitle:start', {
      snapshot: this.getDebugSnapshot(),
      titleLength: args.title.length,
    });

    try {
      await this.beforeMutateHandler?.();
    } catch {
      /* ignore pre-mutation errors */
    }
    const { setter, getter } = this.getTitleHandlers();
    const previousTitle = getter();

    // Update the title
    setter(args.title);

    const result = { newTitle: args.title, previousTitle };
    log('[EditorRuntime] editTitle:success', {
      snapshot: this.getDebugSnapshot(),
      titleLength: args.title.length,
    });

    return result;
  }

  // ==================== Query & Read ====================

  /**
   * Get the current page content and metadata
   * @returns Raw result with document content and metadata
   */
  async getPageContent(args: GetPageContentArgs): Promise<GetPageContentRuntimeResult> {
    log('[EditorRuntime] getPageContent:start', {
      format: args.format,
      snapshot: this.getDebugSnapshot(),
    });

    const context = this.getPageContentContext(args.format);

    return {
      charCount: context.metadata.charCount,
      documentId: this.currentDocId || 'current',
      lineCount: context.metadata.lineCount,
      markdown: context.markdown,
      title: context.metadata.title,
      xml: context.xml,
    };
  }

  /**
   * Get page content context for system prompt injection
   */
  getPageContentContext(format: 'xml' | 'markdown' | 'both' = 'both'): PageContentContext {
    const editor = this.getEditor();
    const { getter: getTitleFn } = this.getTitleHandlers();

    const title = getTitleFn() || 'Untitled';
    const pageXML = editor.getDocument('litexml') as unknown as string;

    log('Getting page content context, format:', format);

    const context: PageContentContext = {
      metadata: { title },
    };

    if (format === 'markdown' || format === 'both') {
      const markdownRaw = editor.getDocument('markdown');
      const markdown = String(markdownRaw || '');
      context.markdown = markdown;
      context.metadata.charCount = markdown.length;
      context.metadata.lineCount = markdown.split('\n').length;
    }

    if (format === 'xml' || format === 'both') {
      context.xml = pageXML || '';
    }

    return context;
  }

  // ==================== Unified Node Operations ====================

  /**
   * Unified node operations API using LITEXML_MODIFY_COMMAND.
   * Supports insert, modify, and remove operations in a single call.
   * @returns Raw result with results, successCount and totalCount
   */
  async modifyNodes(args: ModifyNodesArgs): Promise<ModifyNodesRuntimeResult> {
    const rawOperations = Array.isArray(args.operations)
      ? args.operations
      : args.operations
        ? [args.operations]
        : [];

    log('[EditorRuntime] modifyNodes:start', {
      operationActions: rawOperations.map((op) => op.action),
      operationCount: rawOperations.length,
      snapshot: this.getDebugSnapshot(),
    });

    try {
      await this.beforeMutateHandler?.();
    } catch {
      /* ignore pre-mutation errors */
    }
    const editor = this.getEditor();
    let { operations } = args;

    // Normalize operations to always be an array
    // Handle case where LLM sends a single operation object instead of array
    if (!operations) {
      throw new Error('No operations provided');
    }

    if (!Array.isArray(operations)) {
      log('Converting single operation to array');
      operations = [operations as any];
    }

    log('Processing operations:', operations.length);

    // Build the command payload for LITEXML_MODIFY_COMMAND
    const commandPayload: Array<
      | { action: 'insert'; afterId: string; litexml: string }
      | { action: 'insert'; beforeId: string; litexml: string }
      | { action: 'modify'; litexml: string | string[] }
      | { action: 'remove'; id: string }
    > = [];

    const results: ModifyOperationResult[] = [];

    for (const op of operations) {
      try {
        switch (op.action) {
          case 'insert': {
            if ('beforeId' in op) {
              commandPayload.push({
                action: 'insert',
                beforeId: op.beforeId,
                litexml: op.litexml,
              });
            } else if ('afterId' in op) {
              commandPayload.push({
                action: 'insert',
                afterId: op.afterId,
                litexml: op.litexml,
              });
            }
            results.push({ action: 'insert', success: true });
            break;
          }

          case 'modify': {
            commandPayload.push({
              action: 'modify',
              litexml: op.litexml,
            });
            results.push({ action: 'modify', success: true });
            break;
          }

          case 'remove': {
            commandPayload.push({
              action: 'remove',
              id: op.id,
            });
            results.push({ action: 'remove', success: true });
            break;
          }
        }
      } catch (error) {
        const err = error as Error;
        console.error('[modifyNodes] Error processing operation:', op.action, err.message);
        results.push({ action: op.action, error: err.message, success: false });
      }
    }

    // Dispatch all operations at once
    log('Dispatching LITEXML_MODIFY_COMMAND with payload:', commandPayload);
    const success = editor.dispatchCommand(LITEXML_MODIFY_COMMAND, commandPayload);
    log('Command dispatched, success:', success);

    const successCount = results.filter((r) => r.success).length;
    const totalCount = results.length;

    const result = { results, successCount, totalCount };
    log('[EditorRuntime] modifyNodes:success', {
      snapshot: this.getDebugSnapshot(),
      successCount,
      totalCount,
    });

    return result;
  }

  // ==================== Text Operations ====================

  /**
   * Extract all element nodes with their IDs and content from LiteXML
   * Returns an array of { id, tagName, fullMatch, content } objects
   */
  private extractNodesFromLiteXML(
    litexml: string,
  ): Array<{ content: string; fullMatch: string; id: string; tagName: string }> {
    const nodes: Array<{ content: string; fullMatch: string; id: string; tagName: string }> = [];

    // Match elements with id attributes and their content
    // Pattern: <tagName id="nodeId" ...>content</tagName>
    const elementRegex = /<(\w+)\s[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
    let match;

    while ((match = elementRegex.exec(litexml)) !== null) {
      nodes.push({
        content: match[3],
        fullMatch: match[0],
        id: match[2],
        tagName: match[1],
      });
    }

    return nodes;
  }

  /**
   * Replace text within a content string, preserving XML tags
   */
  private replaceTextInContent(
    content: string,
    searchPattern: RegExp | string,
    newText: string,
    replaceAll: boolean,
  ): { count: number; newContent: string } {
    let count = 0;

    // Split content to preserve nested XML tags while replacing only text portions
    // We need to be careful not to replace text inside tag names or attributes
    const tagRegex = /<[^>]+>/g;
    let tagMatch;

    // Collect all tag positions
    const tagPositions: Array<{ end: number; start: number }> = [];
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      tagPositions.push({ end: tagMatch.index + tagMatch[0].length, start: tagMatch.index });
    }

    // Process text segments between tags
    let currentPos = 0;
    let newContent = '';

    for (const pos of tagPositions) {
      // Text before this tag
      if (currentPos < pos.start) {
        const textPart = content.slice(currentPos, pos.start);
        const { count: segmentCount, replaced } = this.replaceInText(
          textPart,
          searchPattern,
          newText,
          replaceAll && count === 0 ? true : replaceAll,
          replaceAll ? undefined : count === 0,
        );
        newContent += replaced;
        count += segmentCount;
      }
      // Add the tag as-is
      newContent += content.slice(pos.start, pos.end);
      currentPos = pos.end;
    }

    // Text after the last tag
    if (currentPos < content.length) {
      const textPart = content.slice(currentPos);
      const { count: segmentCount, replaced } = this.replaceInText(
        textPart,
        searchPattern,
        newText,
        replaceAll,
        !replaceAll && count > 0 ? false : undefined,
      );
      newContent += replaced;
      count += segmentCount;
    }

    // If no tags were found, replace in the entire content
    if (tagPositions.length === 0) {
      const { count: totalCount, replaced } = this.replaceInText(
        content,
        searchPattern,
        newText,
        replaceAll,
      );
      return { count: totalCount, newContent: replaced };
    }

    return { count, newContent };
  }

  /**
   * Replace text in a string segment
   */
  private replaceInText(
    text: string,
    searchPattern: RegExp | string,
    newText: string,
    replaceAll: boolean,
    shouldReplace: boolean = true,
  ): { count: number; replaced: string } {
    if (!shouldReplace) {
      return { count: 0, replaced: text };
    }

    let count = 0;
    let replaced: string;

    if (typeof searchPattern === 'string') {
      if (replaceAll) {
        // Count occurrences
        const regex = new RegExp(this.escapeRegExp(searchPattern), 'g');
        const matches = text.match(regex);
        count = matches?.length || 0;
        replaced = text.split(searchPattern).join(newText);
      } else {
        // Replace first occurrence only
        const index = text.indexOf(searchPattern);
        if (index !== -1) {
          replaced = text.slice(0, index) + newText + text.slice(index + searchPattern.length);
          count = 1;
        } else {
          replaced = text;
        }
      }
    } else {
      // Regex pattern
      if (replaceAll) {
        // Ensure global flag is set
        const globalPattern = searchPattern.global
          ? searchPattern
          : new RegExp(searchPattern.source, searchPattern.flags + 'g');
        const matches = text.match(globalPattern);
        count = matches?.length || 0;
        replaced = text.replaceAll(globalPattern, newText);
      } else {
        // Replace first match only
        const match = searchPattern.exec(text);
        if (match) {
          replaced = text.replace(searchPattern, newText);
          count = 1;
        } else {
          replaced = text;
        }
      }
    }

    return { count, replaced };
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegExp(str: string): string {
    return str.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
  }

  /**
   * Find and replace text across the document or within specific nodes
   * @returns Raw result with modifiedNodeIds and replacementCount
   */
  async replaceText(args: ReplaceTextArgs): Promise<ReplaceTextRuntimeResult> {
    try {
      await this.beforeMutateHandler?.();
    } catch {
      /* ignore pre-mutation errors */
    }
    const editor = this.getEditor();
    const { searchText, newText, useRegex = false, replaceAll = true, nodeIds } = args;

    log('Starting replacement:', {
      newText,
      nodeIds,
      replaceAll,
      searchText,
      useRegex,
    });

    // Get the current document as LiteXML
    const pageXML = editor.getDocument('litexml') as unknown as string;

    if (!pageXML) {
      throw new Error('Document is empty or not initialized');
    }

    // Create search pattern
    let searchPattern: RegExp | string;
    if (useRegex) {
      try {
        searchPattern = new RegExp(searchText, replaceAll ? 'g' : '');
      } catch {
        throw new Error(`Invalid regex pattern: ${searchText}`);
      }
    } else {
      searchPattern = searchText;
    }

    // Extract nodes from LiteXML
    const nodes = this.extractNodesFromLiteXML(pageXML);
    log('Found nodes:', nodes.length);

    // Filter nodes if nodeIds is specified and non-empty
    // Treat empty array as "search all nodes"
    const hasNodeFilter = nodeIds && nodeIds.length > 0;
    const targetNodes = hasNodeFilter ? nodes.filter((node) => nodeIds.includes(node.id)) : nodes;

    if (hasNodeFilter && targetNodes.length === 0) {
      log(
        '[replaceText] Node IDs requested:',
        nodeIds,
        'Available IDs:',
        nodes.map((n) => n.id),
      );
      throw new Error(`None of the specified nodes were found: ${nodeIds.join(', ')}`);
    }

    // Track replacements
    let totalReplacementCount = 0;
    const modifiedNodeIds: string[] = [];
    const litexmlUpdates: string[] = [];

    // Process each target node
    for (const node of targetNodes) {
      // Check if the node content contains the search text
      const hasMatch =
        typeof searchPattern === 'string'
          ? node.content.includes(searchPattern)
          : searchPattern.test(node.content);

      if (!hasMatch) continue;

      // Reset regex lastIndex if using regex
      if (searchPattern instanceof RegExp) {
        searchPattern.lastIndex = 0;
      }

      // Replace text in the node content
      const { count, newContent } = this.replaceTextInContent(
        node.content,
        searchPattern,
        newText,
        replaceAll,
      );

      if (count > 0) {
        totalReplacementCount += count;
        modifiedNodeIds.push(node.id);

        // Build the updated LiteXML for this node
        // Extract attributes from the original fullMatch
        const firstSpace = node.fullMatch.indexOf(' ');
        const attributes =
          firstSpace > 0 ? node.fullMatch.slice(firstSpace + 1, -1) : `id="${node.id}"`;

        const updatedLitexml = `<${node.tagName} ${attributes}>${newContent}</${node.tagName}>`;
        litexmlUpdates.push(updatedLitexml);

        log('Updated node:', node.id, 'count:', count);

        // If not replacing all, stop after first replacement
        if (!replaceAll) {
          break;
        }
      }
    }

    // Apply updates if any replacements were made
    if (litexmlUpdates.length > 0) {
      log('Applying updates:', litexmlUpdates.length);
      const success = editor.dispatchCommand(LITEXML_APPLY_COMMAND, {
        litexml: litexmlUpdates,
      });
      log('Command dispatched, success:', success);
    }

    return { modifiedNodeIds, replacementCount: totalReplacementCount };
  }
}
