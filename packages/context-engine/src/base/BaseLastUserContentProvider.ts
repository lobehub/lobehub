import type { Message, PipelineContext, ProcessorOptions } from '../types';
import { BaseProcessor } from './BaseProcessor';

const SYSTEM_CONTEXT_START = '<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->';
const SYSTEM_CONTEXT_END = '<!-- END SYSTEM CONTEXT -->';
const CONTEXT_INSTRUCTION = `<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>`;

/**
 * Base Provider for appending content to the last user message
 * Used for injecting real-time context that should reflect the current state
 */
export abstract class BaseLastUserContentProvider extends BaseProcessor {
  constructor(options: ProcessorOptions = {}) {
    super(options);
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
  private hasSystemContextWrapper(content: string | any[]): boolean {
    const textContent = this.getTextContent(content);
    return textContent.includes(SYSTEM_CONTEXT_START) && textContent.includes(SYSTEM_CONTEXT_END);
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
   * Check if the last user message already has a system context wrapper
   */
  protected hasExistingSystemContext(context: PipelineContext): boolean {
    const lastUserIndex = this.findLastUserMessageIndex(context.messages);
    if (lastUserIndex === -1) return false;

    const content = context.messages[lastUserIndex].content;
    return this.hasSystemContextWrapper(content);
  }

  /**
   * Append content to the last user message
   * Handles both string and array content types
   * If system context wrapper already exists, inserts new content into it
   */
  protected appendToLastUserMessage(
    context: PipelineContext,
    contentToAppend: string,
  ): PipelineContext {
    const lastUserIndex = this.findLastUserMessageIndex(context.messages);

    if (lastUserIndex === -1) {
      return context;
    }

    const lastUserMessage = context.messages[lastUserIndex];
    const currentContent = lastUserMessage.content;

    // Handle string content
    if (typeof currentContent === 'string') {
      let newContent: string;

      if (this.hasSystemContextWrapper(currentContent)) {
        // Insert into existing wrapper
        newContent = this.insertIntoExistingWrapper(currentContent, contentToAppend);
      } else {
        // Append normally
        newContent = currentContent + '\n\n' + contentToAppend;
      }

      context.messages[lastUserIndex] = {
        ...lastUserMessage,
        content: newContent,
      };
    }
    // Handle array content (multimodal messages)
    else if (Array.isArray(currentContent)) {
      const lastTextIndex = currentContent.findLastIndex((part: any) => part.type === 'text');

      if (lastTextIndex !== -1) {
        const newContent = [...currentContent];
        const existingText = newContent[lastTextIndex].text;
        let updatedText: string;

        if (this.hasSystemContextWrapper(existingText)) {
          // Insert into existing wrapper
          updatedText = this.insertIntoExistingWrapper(existingText, contentToAppend);
        } else {
          // Append normally
          updatedText = existingText + '\n\n' + contentToAppend;
        }

        newContent[lastTextIndex] = {
          ...newContent[lastTextIndex],
          text: updatedText,
        };
        context.messages[lastUserIndex] = {
          ...lastUserMessage,
          content: newContent,
        };
      } else {
        // No text part found, add a new one
        context.messages[lastUserIndex] = {
          ...lastUserMessage,
          content: [...currentContent, { text: contentToAppend, type: 'text' }],
        };
      }
    }

    return context;
  }

  /**
   * Wrap content with system context markers
   * Following the format from @lobechat/prompts files/index.ts
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
   * Create a context block without the full wrapper (for inserting into existing wrapper)
   */
  protected createContextBlock(content: string, contextType: string): string {
    return `<${contextType}>
${content}
</${contextType}>`;
  }
}
