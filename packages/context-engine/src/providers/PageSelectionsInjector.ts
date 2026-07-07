import { formatContextSelections, formatPageSelections } from '@lobechat/prompts';
import type { ContextSelection, PageSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:PageSelectionsInjector');

export interface PageSelectionsInjectorConfig {
  /** Whether generic contextSelections injection is enabled */
  contextSelectionsEnabled?: boolean;
  /** Whether Page Selections injection is enabled */
  enabled?: boolean;
}

/**
 * Page Selections Injector
 * Responsible for injecting page selections into each user message that has them
 * Unlike PageEditorContextInjector which only injects to the last user message,
 * this processor handles selections attached to any user message in the conversation
 *
 * This injector runs BEFORE PageEditorContextInjector so that:
 * - Each user message with selections gets a SYSTEM CONTEXT wrapper
 * - PageEditorContextInjector can then reuse the wrapper for the last user message
 */
export class PageSelectionsInjector extends BaseEveryUserContentProvider {
  readonly name = 'PageSelectionsInjector';

  constructor(
    private config: PageSelectionsInjectorConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
    index: number,
  ): { content: string; contextType: string } | null {
    const contextSelections = message.metadata?.contextSelections as ContextSelection[] | undefined;

    if (
      (this.config.contextSelectionsEnabled ?? this.config.enabled) &&
      contextSelections &&
      contextSelections.length > 0
    ) {
      const formattedSelections = formatContextSelections(contextSelections);

      if (!formattedSelections) return null;

      log(
        `Building generic context selections for message at index ${index} with ${contextSelections.length} selections`,
      );

      return {
        content: formattedSelections,
        contextType: 'user_context_selections',
      };
    }

    // Legacy pageSelections are scoped to the page editor flow.
    if (!this.config.enabled) {
      return null;
    }

    // Check if message has legacy pageSelections in metadata
    const pageSelections = message.metadata?.pageSelections as PageSelection[] | undefined;

    if (!pageSelections || pageSelections.length === 0) {
      return null;
    }

    // Format the selections
    const formattedSelections = formatPageSelections(pageSelections);

    if (!formattedSelections) {
      return null;
    }

    log(`Building content for message at index ${index} with ${pageSelections.length} selections`);

    return {
      content: formattedSelections,
      contextType: 'user_page_selections',
    };
  }
}
