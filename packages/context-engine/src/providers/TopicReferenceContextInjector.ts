import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    topicReferenceCount?: number;
    topicReferenceInjected?: boolean;
  }
}

const log = debug('context-engine:provider:TopicReferenceContextInjector');

/**
 * Topic reference item
 */
export interface TopicReferenceItem {
  /** Recent messages as fallback when no summary available */
  recentMessages?: Array<{ content: string; role: string }>;
  /** The topic's history summary (undefined if no summary available) */
  summary?: string;
  /** The topic ID */
  topicId: string;
  /** The topic title */
  topicTitle?: string;
}

export interface TopicReferenceContextInjectorConfig {
  /** Whether topic reference context injection is enabled */
  enabled?: boolean;
  /** Referenced topics (with or without summaries) */
  topicReferences?: TopicReferenceItem[];
}

/**
 * Format topic references for injection
 * Topics with summaries are inlined; topics without summaries prompt the agent to use the tool
 */
function formatRecentMessages(messages: Array<{ content: string; role: string }>): string {
  return messages
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
      return `**${role}**: ${msg.content}`;
    })
    .join('\n\n');
}

function formatTopicReferences(items: TopicReferenceItem[]): string | null {
  if (items.length === 0) return null;

  const withContext = items.filter((item) => item.summary || item.recentMessages?.length);
  const withoutContext = items.filter((item) => !item.summary && !item.recentMessages?.length);

  const lines: string[] = [
    '<referred_topics hint="The following are brief summaries or excerpts of referenced topics. For complete conversation history, use the getTopicContext tool.">',
  ];

  for (const item of withContext) {
    const title = item.topicTitle ? ` title="${item.topicTitle}"` : '';
    const type = item.summary ? 'summary' : 'recent_messages';
    lines.push(`<topic id="${item.topicId}"${title} type="${type}">`);
    if (item.summary) {
      lines.push(item.summary);
    } else {
      lines.push(formatRecentMessages(item.recentMessages!));
    }
    lines.push('</topic>');
  }

  if (withoutContext.length > 0) {
    lines.push(
      '<pending_topics hint="No context available for the following topics. Use the getTopicContext tool to retrieve their conversation history.">',
    );
    for (const item of withoutContext) {
      const title = item.topicTitle ? ` title="${item.topicTitle}"` : '';
      lines.push(`<topic id="${item.topicId}"${title} />`);
    }
    lines.push('</pending_topics>');
  }

  lines.push('</referred_topics>');

  return lines.join('\n');
}

/**
 * Topic Reference Context Injector
 *
 * When user messages contain <refer_topic> tags referencing other topics,
 * this injector appends the referenced topics' context to the last user message.
 * - Topics with summaries: summary is inlined directly
 * - Topics without summaries: a hint is added prompting the agent to call the getTopicContext tool
 */
export class TopicReferenceContextInjector extends BaseLastUserContentProvider {
  readonly name = 'TopicReferenceContextInjector';

  constructor(
    private config: TopicReferenceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess called');
    log('config.enabled:', this.config.enabled);

    const clonedContext = this.cloneContext(context);

    if (
      !this.config.enabled ||
      !this.config.topicReferences ||
      this.config.topicReferences.length === 0
    ) {
      log('Topic reference not enabled or no references, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formattedContent = formatTopicReferences(this.config.topicReferences);

    if (!formattedContent) {
      log('No topic reference content to inject');
      return this.markAsExecuted(clonedContext);
    }

    log('Formatted content length:', formattedContent.length);

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    log('Last user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'topic_reference_context')
      : this.wrapWithSystemContext(formattedContent, 'topic_reference_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.topicReferenceInjected = true;
    clonedContext.metadata.topicReferenceCount = this.config.topicReferences.length;

    log('Topic reference context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
