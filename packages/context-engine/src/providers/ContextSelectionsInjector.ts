import { formatContextSelections } from '@lobechat/prompts';
import type { ContextSelection, PageSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ContextSelectionsInjector');

const fromLegacyPageSelections = (
  selections: PageSelection[] | undefined,
): ContextSelection[] | undefined =>
  selections?.map((selection) => ({
    content: selection.content,
    id: selection.id,
    lineRange:
      selection.startLine === undefined
        ? undefined
        : { endLine: selection.endLine ?? selection.startLine, startLine: selection.startLine },
    pageId: selection.pageId,
    source: 'page',
    title: selection.title,
    xml: selection.xml,
  }));

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
    isLastUser: boolean,
  ): { content: string; contextType: string } | null {
    if (!this.config.enabled) {
      return null;
    }

    const attached =
      (message.metadata?.contextSelections as ContextSelection[] | undefined) ??
      fromLegacyPageSelections(message.metadata?.pageSelections as PageSelection[] | undefined);
    // A game snapshot describes the game at one moment and is replaced by the
    // next message's. Older snapshots would only repeat stale state (and keep
    // showing a game after it was closed), so only the latest message keeps it.
    const contextSelections = isLastUser
      ? attached
      : attached?.filter((selection) => selection.source !== 'game');

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
