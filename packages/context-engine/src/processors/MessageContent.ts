import { filesPrompts } from '@lobechat/prompts';
import type { MessageContentPart } from '@lobechat/types';
import { imageUrlToBase64 } from '@lobechat/utils/imageToBase64';
import { parseDataUri } from '@lobechat/utils/uriParser';
import { isDesktopLocalStaticServerUrl } from '@lobechat/utils/url';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:MessageContentProcessor');

/**
 * Deserialize content string to message content parts
 * Returns null if content is not valid JSON array of parts
 */
const deserializeParts = (content: string): MessageContentPart[] | null => {
  try {
    const parsed = JSON.parse(content);
    // Validate it's an array with valid part structure
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.type) {
      return parsed as MessageContentPart[];
    }
  } catch {
    // Not JSON, treat as plain text
  }
  return null;
};

export interface FileContextConfig {
  /** Whether to enable file context injection */
  enabled?: boolean;
  /** Whether to include file URLs in file context prompts */
  includeFileUrl?: boolean;
}

export interface MessageContentConfig {
  /** File context configuration */
  fileContext?: FileContextConfig;
  /** Function to check if video is supported */
  isCanUseVideo?: (model: string, provider: string) => boolean | undefined;
  /** Function to check if vision is supported */
  isCanUseVision?: (model: string, provider: string) => boolean | undefined;
  /** Model name */
  model: string;
  /** Provider name */
  provider: string;
}

export interface UserMessageContentPart {
  googleThoughtSignature?: string;
  image_url?: {
    detail?: string;
    url: string;
  };
  signature?: string;
  text?: string;
  thinking?: string;
  type: 'text' | 'image_url' | 'thinking' | 'video_url';
  video_url?: {
    url: string;
  };
}

/**
 * Message Content Processor
 * Responsible for handling content format conversion of user and assistant messages
 */
export class MessageContentProcessor extends BaseProcessor {
  readonly name = 'MessageContentProcessor';

  constructor(
    private config: MessageContentConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    let userMessagesProcessed = 0;
    let assistantMessagesProcessed = 0;

    // Process the content of each message
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      try {
        let updatedMessage = message;

        if (message.role === 'user') {
          updatedMessage = await this.processUserMessage(message);
          if (updatedMessage !== message) {
            userMessagesProcessed++;
            processedCount++;
          }
        } else if (message.role === 'assistant') {
          updatedMessage = await this.processAssistantMessage(message);
          if (updatedMessage !== message) {
            assistantMessagesProcessed++;
            processedCount++;
          }
        }

        if (updatedMessage !== message) {
          clonedContext.messages[i] = updatedMessage;
          log(`Processed message content ${message.id}, role: ${message.role}`);
        }
      } catch (error) {
        log.extend('error')(`Error processing message ${message.id} content: ${error}`);
        // Continue processing other messages
      }
    }

    // Update metadata
    clonedContext.metadata.messageContentProcessed = processedCount;
    clonedContext.metadata.userMessagesProcessed = userMessagesProcessed;
    clonedContext.metadata.assistantMessagesProcessed = assistantMessagesProcessed;

    log(
      `Message content processing completed, processed ${processedCount} messages (user: ${userMessagesProcessed}, assistant: ${assistantMessagesProcessed})`,
    );

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Process user message content
   */
  private async processUserMessage(message: any): Promise<any> {
    // Check if images, videos or files need processing
    const hasImages = message.imageList && message.imageList.length > 0;
    const hasVideos = message.videoList && message.videoList.length > 0;
    const hasFiles = message.fileList && message.fileList.length > 0;

    // If no images, videos and files, return plain text content directly
    if (!hasImages && !hasVideos && !hasFiles) {
      return {
        ...message,
        content: message.content,
      };
    }

    const contentParts: UserMessageContentPart[] = [];

    // Add text content
    let textContent = message.content || '';

    // Add file context (if file context is enabled and has files, images or videos)
    if ((hasFiles || hasImages || hasVideos) && this.config.fileContext?.enabled) {
      const filesContext = filesPrompts({
        addUrl: this.config.fileContext.includeFileUrl ?? true,
        fileList: message.fileList,
        imageList: message.imageList || [],
        videoList: message.videoList || [],
      });

      if (filesContext) {
        textContent = (textContent + '\n\n' + filesContext).trim();
      }
    }

    // Add text part
    if (textContent) {
      contentParts.push({
        text: textContent,
        type: 'text',
      });
    }

    // Process image content
    if (hasImages && this.config.isCanUseVision?.(this.config.model, this.config.provider)) {
      const imageContentParts = await this.processImageList(message.imageList || []);
      contentParts.push(...imageContentParts);
    }

    // Process video content
    if (hasVideos && this.config.isCanUseVideo?.(this.config.model, this.config.provider)) {
      const videoContentParts = await this.processVideoList(message.videoList || []);
      contentParts.push(...videoContentParts);
    }

    // Explicitly return fields, keeping only necessary message fields
    const hasFileContext = (hasFiles || hasImages || hasVideos) && this.config.fileContext?.enabled;
    const hasVisionContent =
      hasImages && this.config.isCanUseVision?.(this.config.model, this.config.provider);
    const hasVideoContent =
      hasVideos && this.config.isCanUseVideo?.(this.config.model, this.config.provider);

    // If only text content and no file context added and no vision/video content, return plain text
    if (
      contentParts.length === 1 &&
      contentParts[0].type === 'text' &&
      !hasFileContext &&
      !hasVisionContent &&
      !hasVideoContent
    ) {
      return {
        content: contentParts[0].text,
        createdAt: message.createdAt,
        id: message.id,
        meta: message.meta,
        role: message.role,
        updatedAt: message.updatedAt,
        // Keep other potentially needed fields, but remove processed file-related fields
        ...(message.tools && { tools: message.tools }),
        ...(message.tool_calls && { tool_calls: message.tool_calls }),
        ...(message.tool_call_id && { tool_call_id: message.tool_call_id }),
        ...(message.name && { name: message.name }),
      };
    }

    // Return structured content
    return {
      content: contentParts,
      createdAt: message.createdAt,
      id: message.id,
      meta: message.meta,
      role: message.role,
      updatedAt: message.updatedAt,
      // Keep other potentially needed fields, but remove processed file-related fields
      ...(message.tools && { tools: message.tools }),
      ...(message.tool_calls && { tool_calls: message.tool_calls }),
      ...(message.tool_call_id && { tool_call_id: message.tool_call_id }),
      ...(message.name && { name: message.name }),
    };
  }

  /**
   * Process assistant message content
   */
  private async processAssistantMessage(message: any): Promise<any> {
    // Priority 1: Check if there is reasoning content with signature (thinking mode)
    const shouldIncludeThinking = message.reasoning && !!message.reasoning?.signature;

    if (shouldIncludeThinking) {
      const contentParts: UserMessageContentPart[] = [
        {
          signature: message.reasoning!.signature,
          thinking: message.reasoning!.content,
          type: 'thinking',
        },
        {
          text: message.content,
          type: 'text',
        },
      ];

      return {
        ...message,
        content: contentParts,
      };
    }

    // Priority 2: Check if reasoning content is multimodal
    const hasMultimodalReasoning = message.reasoning?.isMultimodal && message.reasoning?.content;

    if (hasMultimodalReasoning) {
      const reasoningParts = deserializeParts(message.reasoning.content);
      if (reasoningParts) {
        // Convert reasoning multimodal parts to plain text
        const reasoningText = reasoningParts
          .map((part) => {
            if (part.type === 'text') return part.text;
            if (part.type === 'image') return `[Image: ${part.image}]`;
            return '';
          })
          .join('\n');

        // Update reasoning to plain text
        const updatedMessage = {
          ...message,
          reasoning: {
            ...message.reasoning,
            content: reasoningText,
            isMultimodal: false, // Convert to non-multimodal
          },
        };

        // Handle main content based on whether it's multimodal
        if (message.metadata?.isMultimodal && message.content) {
          const contentParts = deserializeParts(message.content);
          if (contentParts) {
            const convertedParts = this.convertMessagePartsToContentParts(contentParts);
            return {
              ...updatedMessage,
              content: convertedParts,
            };
          }
        }

        return updatedMessage;
      }
    }

    // Priority 3: Check if message content is multimodal
    const hasMultimodalContent = message.metadata?.isMultimodal && message.content;

    if (hasMultimodalContent) {
      const parts = deserializeParts(message.content);
      if (parts) {
        const contentParts = this.convertMessagePartsToContentParts(parts);
        return { ...message, content: contentParts };
      }
    }

    // Priority 4: Check if there are images (legacy imageList field)
    const hasImages = message.imageList && message.imageList.length > 0;

    if (hasImages && this.config.isCanUseVision?.(this.config.model, this.config.provider)) {
      // Create structured content
      const contentParts: UserMessageContentPart[] = [];

      if (message.content) {
        contentParts.push({
          text: message.content,
          type: 'text',
        });
      }

      // Process image content
      const imageContentParts = await this.processImageList(message.imageList || []);
      contentParts.push(...imageContentParts);

      return { ...message, content: contentParts };
    }

    // Regular assistant message, return plain text content
    return {
      ...message,
      content: message.content,
    };
  }

  /**
   * Convert MessageContentPart[] (internal format) to OpenAI-compatible UserMessageContentPart[]
   */
  private convertMessagePartsToContentParts(parts: MessageContentPart[]): UserMessageContentPart[] {
    const contentParts: UserMessageContentPart[] = [];

    for (const part of parts) {
      if (part.type === 'text') {
        contentParts.push({
          googleThoughtSignature: part.thoughtSignature,
          text: part.text,
          type: 'text',
        });
      } else if (part.type === 'image') {
        // Images are already in S3 URL format, no conversion needed
        contentParts.push({
          googleThoughtSignature: part.thoughtSignature,
          image_url: { detail: 'auto', url: part.image },
          type: 'image_url',
        });
      }
    }

    return contentParts;
  }

  /**
   * Process image list
   */
  private async processImageList(imageList: any[]): Promise<UserMessageContentPart[]> {
    if (!imageList || imageList.length === 0) {
      return [];
    }

    return Promise.all(
      imageList.map(async (image) => {
        const { type } = parseDataUri(image.url);

        let processedUrl = image.url;
        if (type === 'url' && isDesktopLocalStaticServerUrl(image.url)) {
          const { base64, mimeType } = await imageUrlToBase64(image.url);
          processedUrl = `data:${mimeType};base64,${base64}`;
        }

        return {
          image_url: { detail: 'auto', url: processedUrl },
          type: 'image_url',
        } as UserMessageContentPart;
      }),
    );
  }

  /**
   * Process video list
   */
  private async processVideoList(videoList: any[]): Promise<UserMessageContentPart[]> {
    if (!videoList || videoList.length === 0) {
      return [];
    }

    return videoList.map((video) => {
      return {
        type: 'video_url',
        video_url: { url: video.url },
      } as UserMessageContentPart;
    });
  }

  /**
   * Validate content part format
   */
  private validateContentPart(part: UserMessageContentPart): boolean {
    if (!part || !part.type) return false;

    switch (part.type) {
      case 'text': {
        return typeof part.text === 'string';
      }
      case 'image_url': {
        return !!(part.image_url && part.image_url.url);
      }
      case 'thinking': {
        return !!(part.thinking && part.signature);
      }
      case 'video_url': {
        return !!(part.video_url && part.video_url.url);
      }
      default: {
        return false;
      }
    }
  }
}
