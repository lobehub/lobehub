import type { PageContentContext } from '@lobechat/prompts';
import { formatPageContentContext } from '@lobechat/prompts';
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
}

/**
 * Page Editor Context Injector
 * Responsible for injecting current page context at the end of the last user message
 * This ensures the model receives the most up-to-date page/document state
 *
 * Note: Page selections (user-selected text regions) are handled separately by
 * PageSelectionsInjector, which injects selections into each user message that has them
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

    const clonedContext = this.cloneContext(context);

    // Check if we have page content to inject
    const hasPageContent = this.config.enabled && this.config.pageContentContext;

    if (!hasPageContent) {
      log('No pageContentContext, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Find the last user message index
    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    log('Last user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Format page content
    const formattedContent = formatPageContentContext(this.config.pageContentContext!);

    if (!formattedContent) {
      log('No content to inject after formatting');
      return this.markAsExecuted(clonedContext);
    }

    log('Page content formatted, length:', formattedContent.length);

    // Check if system context wrapper already exists
    // If yes, only insert context block; if no, use full wrapper
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'current_page_context')
      : this.wrapWithSystemContext(formattedContent, 'current_page_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    // Update metadata
    clonedContext.metadata.pageEditorContextInjected = true;

    log('Page Editor context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
