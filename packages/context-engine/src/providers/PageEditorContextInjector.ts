import {
  type PageContentContext,
  formatPageContentContext,
  formatPageSelections,
} from '@lobechat/prompts';
import type { PageSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

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
   * Page selections to inject (optional, from external source)
   * If provided, takes precedence over extracting from messages
   * If not provided, will be extracted from the last user message's metadata
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

  /**
   * Extract pageSelections from the last user message's metadata
   * Used for Ask AI functionality to inject user-selected text into context
   */
  private extractPageSelectionsFromMessages(messages: Message[]): PageSelection[] | undefined {
    // Find the last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user') {
        // Return pageSelections from metadata if available
        // Message type has [key: string]: any, so metadata.pageSelections is accessible
        return msg.metadata?.pageSelections as PageSelection[] | undefined;
      }
    }
    return undefined;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess called');
    log('config.enabled:', this.config.enabled);
    log('config.pageSelections:', this.config.pageSelections?.length ?? 0);

    const clonedContext = this.cloneContext(context);

    // Use config.pageSelections first, fallback to extracting from last user message's metadata
    const pageSelections =
      this.config.pageSelections ?? this.extractPageSelectionsFromMessages(context.messages);
    log('final pageSelections:', pageSelections?.length ?? 0);

    // Check if we have any content to inject
    const hasPageContent = this.config.enabled && this.config.pageContentContext;
    const hasPageSelections = pageSelections && pageSelections.length > 0;

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

    // Add page content context if present (first)
    if (hasPageContent) {
      const formattedContent = formatPageContentContext(this.config.pageContentContext!);
      if (formattedContent) {
        contentSections.push(formattedContent);
        log('Page content formatted, length:', formattedContent.length);
      }
    }

    // Add page selections if present (last, closer to user's question)
    if (hasPageSelections) {
      const formattedSelections = formatPageSelections(pageSelections!);
      if (formattedSelections) {
        contentSections.push(formattedSelections);
        log('Page selections formatted, length:', formattedSelections.length);
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
