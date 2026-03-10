import type { Message, PipelineContext, ProcessorOptions } from '../types';
import { BaseProcessor } from './BaseProcessor';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from './constants';

/**
 * Base Provider for appending content to every user message
 * Used for injecting context that should be attached to each user message individually
 * (e.g., page selections that are specific to each message)
 *
 * Features:
 * - Iterates through all user messages
 * - For each message, calls buildContentForMessage to get content to inject
 * - Wraps content with SYSTEM CONTEXT markers (or reuses existing wrapper)
 * - Runs BEFORE BaseLastUserContentProvider so that the last user message
 *   can reuse the SYSTEM CONTEXT wrapper created here
 */
export abstract class BaseEveryUserContentProvider extends BaseProcessor {
  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  /**
   * Build the content to inject for a specific user message
   * Subclasses must implement this method
   * @param message - The user message to build content for
   * @param index - The index of the message in the messages array
   * @param isLastUser - Whether this is the last user message
   * @returns Object with content and contextType, or null to skip injection for this message
   */
  protected abstract buildContentForMessage(
    message: Message,
    index: number,
    isLastUser: boolean,
  ): { content: string; contextType: string } | null;

  /**
   * Get the text content from a message (handles both string and array content)
   */
  private getTextContent(content: string | any[]): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const lastTextPart = content.findLast((part: any) => part.type === 'text');
      return lastTextPart?.text || '';
    }
    return '';
  }

  /**
   * Check if the content already has a system context wrapper
   */
  protected hasSystemContextWrapper(content: string | any[]): boolean {
    const textContent = this.getTextContent(content);
    return textContent.includes(SYSTEM_CONTEXT_START) && textContent.includes(SYSTEM_CONTEXT_END);
  }

  /**
   * Wrap content with system context markers
   */
  protected wrapWithSystemContext(content: string, contextType: string): string {
    return `${SYSTEM_CONTEXT_START}
${CONTEXT_INSTRUCTION}
<${contextType}>
${content}
</${contextType}>
${SYSTEM_CONTEXT_END}`;
  }

  /**
   * Insert content into existing system context wrapper (before the END marker)
   */
  private insertIntoExistingWrapper(existingContent: string, newContextBlock: string): string {
    const endMarkerIndex = existingContent.lastIndexOf(SYSTEM_CONTEXT_END);
    if (endMarkerIndex === -1) {
      return existingContent + '\n\n' + newContextBlock;
    }

    const beforeEnd = existingContent.slice(0, endMarkerIndex);
    const afterEnd = existingContent.slice(endMarkerIndex);

    return beforeEnd + newContextBlock + '\n' + afterEnd;
  }

  /**
   * Create a context block without the full wrapper (for inserting into existing wrapper)
   */
  protected createContextBlock(content: string, contextType: string): string {
    return `<${contextType}>
${content}
</${contextType}>`;
  }

  /**
   * Append content to a message with SYSTEM CONTEXT wrapper
   */
  protected appendToMessage(message: Message, content: string, contextType: string): Message {
    const currentContent = message.content;

    // Handle string content
    if (typeof currentContent === 'string') {
      let newContent: string;

      if (this.hasSystemContextWrapper(currentContent)) {
        // Insert into existing wrapper
        const contextBlock = this.createContextBlock(content, contextType);
        newContent = this.insertIntoExistingWrapper(currentContent, contextBlock);
      } else {
        // Create new wrapper
        newContent = currentContent + '\n\n' + this.wrapWithSystemContext(content, contextType);
      }

      return {
        ...message,
        content: newContent,
      };
    }

    // Handle array content (multimodal messages)
    if (Array.isArray(currentContent)) {
      const lastTextIndex = currentContent.findLastIndex((part: any) => part.type === 'text');

      if (lastTextIndex !== -1) {
        const newContent = [...currentContent];
        const existingText = newContent[lastTextIndex].text;
        let updatedText: string;

        if (this.hasSystemContextWrapper(existingText)) {
          // Insert into existing wrapper
          const contextBlock = this.createContextBlock(content, contextType);
          updatedText = this.insertIntoExistingWrapper(existingText, contextBlock);
        } else {
          // Create new wrapper
          updatedText = existingText + '\n\n' + this.wrapWithSystemContext(content, contextType);
        }

        newContent[lastTextIndex] = {
          ...newContent[lastTextIndex],
          text: updatedText,
        };
        return {
          ...message,
          content: newContent,
        };
      } else {
        // No text part found, add a new one with wrapper
        return {
          ...message,
          content: [
            ...currentContent,
            { text: this.wrapWithSystemContext(content, contextType), type: 'text' },
          ],
        };
      }
    }

    return message;
  }

  /**
   * Find the index of the last user message
   */
  protected findLastUserMessageIndex(messages: Message[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }

  /**
   * Process the context by injecting content to every user message
   */
  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);
    let injectCount = 0;

    // Iterate through all messages
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // Only process user messages
      if (message.role !== 'user') continue;

      const isLastUser = i === lastUserIndex;
      const result = this.buildContentForMessage(message, i, isLastUser);

      if (!result) continue;

      // Append to this user message with SYSTEM CONTEXT wrapper
      clonedContext.messages[i] = this.appendToMessage(message, result.content, result.contextType);
      injectCount++;
    }

    // Update metadata with injection count
    if (injectCount > 0) {
      clonedContext.metadata[`${this.name}InjectedCount`] = injectCount;
    }

    return this.markAsExecuted(clonedContext);
  }
}
