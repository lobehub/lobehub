import { formatContextSelections } from '@lobechat/prompts';
import type { ContextSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ContextSelectionsInjector');

export interface ContextSelectionsInjectorConfig {
  /** Whether generic contextSelections injection is enabled */
  enabled?: boolean;
}

/**
 * Injects generic user-attached context selections into each user message that owns them.
 *
 * These selections are not page-editor selections: they can come from chat text,
 * code snippets, page selections normalized into the generic format, or other
 * future context sources.
 */
export class ContextSelectionsInjector extends BaseEveryUserContentProvider {
  readonly name = 'ContextSelectionsInjector';

  constructor(
    private config: ContextSelectionsInjectorConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
    index: number,
  ): { content: string; contextType: string } | null {
    if (!this.config.enabled) {
      return null;
    }

    const contextSelections = message.metadata?.contextSelections as ContextSelection[] | undefined;

    if (!contextSelections || contextSelections.length === 0) {
      return null;
    }

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
}
