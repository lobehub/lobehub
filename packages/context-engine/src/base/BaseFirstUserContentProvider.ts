import type { Message, PipelineContext, ProcessorOptions } from '../types';
import { BaseProcessor } from './BaseProcessor';

/**
 * Marker to identify system injection messages
 */
const SYSTEM_INJECTION_MARKER = 'systemInjection';

/**
 * Base Provider for prepending content before the first user message
 * Used for injecting static context like knowledge and user memories
 *
 * Features:
 * - First provider creates a new user message before the first user message
 * - Subsequent providers append to the existing system injection message
 * - All injected content is consolidated into a single message
 */
export abstract class BaseFirstUserContentProvider extends BaseProcessor {
  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  /**
   * Build the content to inject
   * Subclasses must implement this method
   * @returns The content string to inject, or null to skip injection
   */
  protected abstract buildContent(context: PipelineContext): string | null;

  /**
   * Find the index of the first user message
   */
  protected findFirstUserMessageIndex(messages: Message[]): number {
    return messages.findIndex((msg) => msg.role === 'user');
  }

  /**
   * Find the existing system injection message (if any)
   */
  protected findSystemInjectionMessage(messages: Message[]): Message | undefined {
    return messages.find((msg) => msg.meta?.[SYSTEM_INJECTION_MARKER] === true);
  }

  /**
   * Find the index of the existing system injection message
   */
  protected findSystemInjectionMessageIndex(messages: Message[]): number {
    return messages.findIndex((msg) => msg.meta?.[SYSTEM_INJECTION_MARKER] === true);
  }

  /**
   * Create a new system injection message
   */
  protected createSystemInjectionMessage(content: string): Message {
    return {
      content,
      createdAt: Date.now(),
      id: `system-injection-${Date.now()}`,
      meta: { [SYSTEM_INJECTION_MARKER]: true },
      role: 'user' as const,
      updatedAt: Date.now(),
    };
  }

  /**
   * Append content to an existing message
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

    // Handle array content (multimodal messages) - find last text part and append
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

      // No text part found, add a new one
      return {
        ...message,
        content: [...currentContent, { text: contentToAppend, type: 'text' }],
        updatedAt: Date.now(),
      };
    }

    return message;
  }

  /**
   * Process the context by injecting content before the first user message
   * If a system injection message already exists, append to it instead
   */
  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const content = this.buildContent(context);

    if (!content) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    const existingIndex = this.findSystemInjectionMessageIndex(clonedContext.messages);

    if (existingIndex !== -1) {
      // Append to existing system injection message
      clonedContext.messages[existingIndex] = this.appendToMessage(
        clonedContext.messages[existingIndex],
        content,
      );
    } else {
      // Create new system injection message before first user message
      const firstUserIndex = this.findFirstUserMessageIndex(clonedContext.messages);

      if (firstUserIndex === -1) {
        // No user messages found, skip injection
        return this.markAsExecuted(clonedContext);
      }

      const injectionMessage = this.createSystemInjectionMessage(content);
      clonedContext.messages.splice(firstUserIndex, 0, injectionMessage);
    }

    return this.markAsExecuted(clonedContext);
  }
}
