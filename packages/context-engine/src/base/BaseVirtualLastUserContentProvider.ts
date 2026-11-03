import type { Message, PipelineContext, ProcessorOptions } from '../types';
import { BaseProcessor } from './BaseProcessor';

/**
 * Marker to identify runtime-injected virtual last-user messages.
 */
const VIRTUAL_LAST_USER_MARKER = 'virtualLastUser';

/**
 * Base provider for injecting content at the virtual "last user" position.
 *
 * Behavior:
 * - If the current last message is a user message, append to it directly
 * - Otherwise create a synthetic user message at the tail of the message list
 * - Multiple virtual-last-user providers can reuse the same synthetic tail message
 *
 * This is intended for high-churn runtime guidance that should stay at the end
 * of the prompt so earlier stable prefixes can still benefit from cache hits.
 */
export abstract class BaseVirtualLastUserContentProvider extends BaseProcessor {
  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  /**
   * Build the content to inject.
   */
  protected abstract buildContent(context: PipelineContext): string | null;

  /**
   * Allow subclasses to skip injection based on the current context.
   */
  protected shouldSkip(_context: PipelineContext): boolean {
    return false;
  }

  /**
   * Create metadata for the synthetic tail user message.
   */
  protected createVirtualLastUserMeta(): Record<string, any> {
    return {
      injectType: this.name,
      [VIRTUAL_LAST_USER_MARKER]: true,
    };
  }

  /**
   * Create a synthetic tail user message.
   */
  protected createVirtualLastUserMessage(content: string): Message {
    return {
      content,
      createdAt: Date.now(),
      id: `virtual-last-user-${this.name}-${Date.now()}`,
      meta: this.createVirtualLastUserMeta(),
      role: 'user' as const,
      updatedAt: Date.now(),
    };
  }

  /**
   * Append content to an existing user message.
   */
  protected appendToMessage(message: Message, contentToAppend: string): Message {
    const currentContent = message.content;

    if (typeof currentContent === 'string') {
      return {
        ...message,
        content: currentContent + '\n\n' + contentToAppend,
        updatedAt: Date.now(),
      };
    }

    if (Array.isArray(currentContent)) {
      const lastTextIndex = currentContent.findLastIndex((part: any) => part.type === 'text');

      if (lastTextIndex !== -1) {
        const newContent = [...currentContent];
        newContent[lastTextIndex] = {
          ...newContent[lastTextIndex],
          text: newContent[lastTextIndex].text + '\n\n' + contentToAppend,
        };

        return {
          ...message,
          content: newContent,
          updatedAt: Date.now(),
        };
      }

      return {
        ...message,
        content: [...currentContent, { text: contentToAppend, type: 'text' }],
        updatedAt: Date.now(),
      };
    }

    return message;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.shouldSkip(context)) {
      return this.markAsExecuted(context);
    }

    const content = this.buildContent(context);

    if (!content) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    const lastMessage = clonedContext.messages.at(-1);

    if (lastMessage?.role === 'user') {
      clonedContext.messages[clonedContext.messages.length - 1] = this.appendToMessage(
        lastMessage,
        content,
      );
      return this.markAsExecuted(clonedContext);
    }

    clonedContext.messages.push(this.createVirtualLastUserMessage(content));

    return this.markAsExecuted(clonedContext);
  }
}
