import {
  type PageContentContext,
  formatPageContentContext,
  formatPageSelections,
} from '@lobechat/prompts';
import type { PageSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:PageEditorContextInjector');

export interface PageEditorContextInjectorConfig {
  /** Whether Page Editor/Agent is enabled */
  enabled?: boolean;
  /**
   * Page content context to inject
   * Contains markdown, xml, and metadata for the current page
   */
  pageContentContext?: PageContentContext;
  /**
   * Page selections to inject (from user message metadata)
   * Contains selected text regions for Ask AI functionality
   */
  pageSelections?: PageSelection[];
}

/**
 * Page Editor Context Injector
 * Responsible for injecting current page context at the end of the last user message
 * This ensures the model receives the most up-to-date page/document state
 */
export class PageEditorContextInjector extends BaseLastUserContentProvider {
  readonly name = 'PageEditorContextInjector';

  constructor(
    private config: PageEditorContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess called');
    log('config.enabled:', this.config.enabled);
    log('config.pageSelections:', this.config.pageSelections?.length ?? 0);

    const clonedContext = this.cloneContext(context);

    // Check if we have any content to inject
    const hasPageContent = this.config.enabled && this.config.pageContentContext;
    const hasPageSelections = this.config.pageSelections && this.config.pageSelections.length > 0;

    // Skip if neither page content nor page selections
    if (!hasPageContent && !hasPageSelections) {
      log('No pageContentContext and no pageSelections, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Find the last user message index
    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    log('Last user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Build content sections to inject
    const contentSections: string[] = [];

    // Add page selections if present
    if (hasPageSelections) {
      const formattedSelections = formatPageSelections(this.config.pageSelections!);
      if (formattedSelections) {
        contentSections.push(formattedSelections);
        log('Page selections formatted, length:', formattedSelections.length);
      }
    }

    // Add page content context if present
    if (hasPageContent) {
      const formattedContent = formatPageContentContext(this.config.pageContentContext!);
      if (formattedContent) {
        contentSections.push(formattedContent);
        log('Page content formatted, length:', formattedContent.length);
      }
    }

    // Skip if no content to inject
    if (contentSections.length === 0) {
      log('No content to inject after formatting');
      return this.markAsExecuted(clonedContext);
    }

    const combinedContent = contentSections.join('\n\n');

    // Check if system context wrapper already exists
    // If yes, only insert context block; if no, use full wrapper
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(combinedContent, 'current_page_context')
      : this.wrapWithSystemContext(combinedContent, 'current_page_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    // Update metadata
    clonedContext.metadata.pageEditorContextInjected = true;
    if (hasPageSelections) {
      clonedContext.metadata.pageSelectionsInjected = true;
    }

    log('Page Editor context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
