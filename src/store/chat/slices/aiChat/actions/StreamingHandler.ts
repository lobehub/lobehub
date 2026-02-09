import type {
  ChatImageItem,
  ChatToolPayload,
  MessageContentPart,
  MessageToolCall,
} from '@lobechat/types';
import { serializePartsForStorage } from '@lobechat/utils';
import debug from 'debug';
import { throttle } from 'es-toolkit/compat';
import pMap from 'p-map';

import { cleanSpeakerTag } from '../../../utils/cleanSpeakerTag';
import type {
  FinishData,
  GroundingData,
  ReasoningState,
  StreamChunk,
  StreamingCallbacks,
  StreamingContext,
  StreamingResult,
} from './types/streaming';

const log = debug('lobe-store:streaming-handler');

/**
 * Streaming message handler
 *
 * Encapsulates all state and logic for streaming message processing, including:
 * - Text content accumulation
 * - Reasoning content processing
 * - Multimodal content processing
 * - Tool calls processing
 * - Image upload management
 *
 * @example
 * ```typescript
 * const handler = new StreamingHandler(context, callbacks);
 *
 * // During streaming
 * handler.handleChunk(chunk);
 *
 * // When streaming completes
 * const result = await handler.handleFinish(finishData);
 * ```
 */
export class StreamingHandler {
  // ========== Text state ==========
  private output = '';

  // ========== Reasoning state ==========
  private thinkingContent = '';
  private thinkingStartAt?: number;
  private thinkingDuration?: number;
  private reasoningOperationId?: string;
  private reasoningParts: MessageContentPart[] = [];

  // ========== Multimodal state ==========
  private contentParts: MessageContentPart[] = [];

  // ========== Tool call state ==========
  private isFunctionCall = false;
  private tools?: ChatToolPayload[];

  // ========== Image upload state ==========
  private uploadTasks = new Map<string, Promise<{ id?: string; url?: string }>>();
  private contentImageUploads = new Map<number, Promise<string>>();
  private reasoningImageUploads = new Map<number, Promise<string>>();

  // ========== Other state ==========
  private msgTraceId?: string;
  private finishType?: string;

  // ========== Throttled updates ==========
  private throttledUpdateToolCalls: ReturnType<typeof throttle>;

  constructor(
    private context: StreamingContext,
    private callbacks: StreamingCallbacks,
  ) {
    // Initialize throttled tool calls update (max once per 300ms)
    this.throttledUpdateToolCalls = throttle(
      (toolCalls) => {
        const tools = this.callbacks.transformToolCalls(toolCalls);
        this.callbacks.onToolCallsUpdate(tools);
      },
      300,
      { leading: true, trailing: true },
    );
  }

  // ==================== Public API ====================

  /**
   * Handle streaming chunk
   */
  handleChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'text': {
        this.handleTextChunk(chunk);
        break;
      }
      case 'reasoning': {
        this.handleReasoningChunk(chunk);
        break;
      }
      case 'reasoning_part': {
        this.handleReasoningPartChunk(chunk);
        break;
      }
      case 'content_part': {
        this.handleContentPartChunk(chunk);
        break;
      }
      case 'tool_calls': {
        this.handleToolCallsChunk(chunk);
        break;
      }
      case 'grounding': {
        this.handleGroundingChunk(chunk);
        break;
      }
      case 'base64_image': {
        this.handleBase64ImageChunk(chunk);
        break;
      }
      case 'stop': {
        this.handleStopChunk();
        break;
      }
    }
  }

  /**
   * Handle streaming finish
   */
  async handleFinish(finishData: FinishData): Promise<StreamingResult> {
    // Update traceId
    if (finishData.traceId) {
      this.msgTraceId = finishData.traceId;
    }

    // Wait for all image uploads to complete
    const finalImages = await this.waitForImageUploads();

    // Wait for multimodal image uploads to complete
    await this.waitForMultimodalUploads();

    // Process final tool calls
    this.processFinalToolCalls(finishData.toolCalls);

    // Build final result
    return this.buildFinalResult(finishData, finalImages);
  }

  /**
   * Get current output content
   */
  getOutput(): string {
    return this.output;
  }

  /**
   * Get reasoning duration
   */
  getThinkingDuration(): number | undefined {
    return this.thinkingDuration;
  }

  /**
   * Check if this is a function call
   */
  getIsFunctionCall(): boolean {
    return this.isFunctionCall;
  }

  /**
   * Get tools
   */
  getTools(): ChatToolPayload[] | undefined {
    return this.tools;
  }

  /**
   * Get trace ID
   */
  getTraceId(): string | undefined {
    return this.msgTraceId;
  }

  /**
   * Get finish type
   */
  getFinishType(): string | undefined {
    return this.finishType;
  }

  // ==================== Chunk handling methods ====================

  private handleTextChunk(chunk: { text: string; type: 'text' }): void {
    this.output += chunk.text;

    // Clean speaker tag that may be reproduced by model in group chat
    this.output = cleanSpeakerTag(this.output);

    // End reasoning timing
    this.endReasoningIfNeeded();

    log(
      '[text stream] messageId=%s, output length=%d, operationId=%s',
      this.context.messageId,
      this.output.length,
      this.context.operationId,
    );

    // Notify update
    this.callbacks.onContentUpdate(this.output, this.buildReasoningState());
  }

  private handleReasoningChunk(chunk: { text: string; type: 'reasoning' }): void {
    // Start reasoning timing
    this.startReasoningIfNeeded();

    this.thinkingContent += chunk.text;

    this.callbacks.onReasoningUpdate({ content: this.thinkingContent });
  }

  private handleReasoningPartChunk(chunk: {
    content: string;
    mimeType?: string;
    partType: 'text' | 'image';
    type: 'reasoning_part';
  }): void {
    // Start reasoning timing
    this.startReasoningIfNeeded();

    if (chunk.partType === 'text') {
      this.appendTextToReasoningParts(chunk.content);
      this.thinkingContent += chunk.content;
    } else if (chunk.partType === 'image' && chunk.mimeType) {
      this.appendImageToReasoningParts(chunk.content, chunk.mimeType);
    }

    // Notify update
    const hasImages = this.reasoningParts.some((p) => p.type === 'image');
    this.callbacks.onReasoningUpdate(
      hasImages
        ? { isMultimodal: true, tempDisplayContent: this.reasoningParts }
        : { content: this.thinkingContent },
    );
  }

  private handleContentPartChunk(chunk: {
    content: string;
    mimeType?: string;
    partType: 'text' | 'image';
    type: 'content_part';
  }): void {
    // End reasoning timing
    this.endReasoningIfNeeded();

    if (chunk.partType === 'text') {
      this.appendTextToContentParts(chunk.content);
      this.output += chunk.content;

      // Clean speaker tag
      this.output = cleanSpeakerTag(this.output);
    } else if (chunk.partType === 'image' && chunk.mimeType) {
      this.appendImageToContentParts(chunk.content, chunk.mimeType);
    }

    // Notify update
    this.notifyContentPartUpdate();
  }

  private handleToolCallsChunk(chunk: {
    isAnimationActives?: boolean[];
    tool_calls: MessageToolCall[];
    type: 'tool_calls';
  }): void {
    this.isFunctionCall = true;
    this.callbacks.toggleToolCallingStreaming(this.context.messageId, chunk.isAnimationActives);
    this.throttledUpdateToolCalls(chunk.tool_calls);

    // End reasoning timing
    this.endReasoningIfNeeded();
  }

  private handleGroundingChunk(chunk: { grounding?: GroundingData; type: 'grounding' }): void {
    if (!chunk.grounding?.citations?.length) return;

    this.callbacks.onGroundingUpdate({
      citations: chunk.grounding.citations,
      searchQueries: chunk.grounding.searchQueries,
    });
  }

  private handleBase64ImageChunk(chunk: {
    image: { data: string; id: string };
    images: { data: string; id: string }[];
    type: 'base64_image';
  }): void {
    // Immediately display images
    this.callbacks.onImagesUpdate(chunk.images.map((i) => ({ alt: i.id, id: i.id, url: i.data })));

    // Async upload
    const task = this.callbacks.uploadBase64Image(chunk.image.data);
    this.uploadTasks.set(chunk.image.id, task);
  }

  private handleStopChunk(): void {
    this.endReasoningIfNeeded();
  }

  // ==================== Helper methods ====================

  private startReasoningIfNeeded(): void {
    if (!this.thinkingStartAt) {
      this.thinkingStartAt = Date.now();
      this.reasoningOperationId = this.callbacks.onReasoningStart();
    }
  }

  private endReasoningIfNeeded(): void {
    if (this.thinkingStartAt && !this.thinkingDuration) {
      this.thinkingDuration = Date.now() - this.thinkingStartAt;

      if (this.reasoningOperationId) {
        this.callbacks.onReasoningComplete(this.reasoningOperationId);
        this.reasoningOperationId = undefined;
      }
    }
  }

  private appendTextToReasoningParts(text: string): void {
    const lastPart = this.reasoningParts.at(-1);
    if (lastPart?.type === 'text') {
      this.reasoningParts = [
        ...this.reasoningParts.slice(0, -1),
        { text: lastPart.text + text, type: 'text' },
      ];
    } else {
      this.reasoningParts = [...this.reasoningParts, { text, type: 'text' }];
    }
  }

  private appendImageToReasoningParts(base64Content: string, mimeType: string): void {
    const tempImage = `data:${mimeType};base64,${base64Content}`;
    const partIndex = this.reasoningParts.length;
    this.reasoningParts = [...this.reasoningParts, { image: tempImage, type: 'image' }];

    // Async upload
    const uploadTask = this.callbacks
      .uploadBase64Image(tempImage)
      .then((file) => {
        const url = file?.url || tempImage;
        const updatedParts = [...this.reasoningParts];
        updatedParts[partIndex] = { image: url, type: 'image' };
        this.reasoningParts = updatedParts;
        return url;
      })
      .catch((error) => {
        console.error('[reasoning_part] Image upload failed:', error);
        return tempImage;
      });

    this.reasoningImageUploads.set(partIndex, uploadTask);
  }

  private appendTextToContentParts(text: string): void {
    const lastPart = this.contentParts.at(-1);
    if (lastPart?.type === 'text') {
      this.contentParts = [
        ...this.contentParts.slice(0, -1),
        { text: lastPart.text + text, type: 'text' },
      ];
    } else {
      this.contentParts = [...this.contentParts, { text, type: 'text' }];
    }
  }

  private appendImageToContentParts(base64Content: string, mimeType: string): void {
    const tempImage = `data:${mimeType};base64,${base64Content}`;
    const partIndex = this.contentParts.length;
    this.contentParts = [...this.contentParts, { image: tempImage, type: 'image' }];

    // Async upload
    const uploadTask = this.callbacks
      .uploadBase64Image(tempImage)
      .then((file) => {
        const url = file?.url || tempImage;
        const updatedParts = [...this.contentParts];
        updatedParts[partIndex] = { image: url, type: 'image' };
        this.contentParts = updatedParts;
        return url;
      })
      .catch((error) => {
        console.error('[content_part] Image upload failed:', error);
        return tempImage;
      });

    this.contentImageUploads.set(partIndex, uploadTask);
  }

  private notifyContentPartUpdate(): void {
    const hasContentImages = this.contentParts.some((p) => p.type === 'image');
    const hasReasoningImages = this.reasoningParts.some((p) => p.type === 'image');

    this.callbacks.onContentUpdate(
      this.output,
      hasReasoningImages
        ? {
            duration: this.thinkingDuration,
            isMultimodal: true,
            tempDisplayContent: this.reasoningParts,
          }
        : this.thinkingContent
          ? { content: this.thinkingContent, duration: this.thinkingDuration }
          : undefined,
      hasContentImages
        ? {
            isMultimodal: true,
            tempDisplayContent: serializePartsForStorage(this.contentParts),
          }
        : undefined,
    );
  }

  private buildReasoningState(): ReasoningState | undefined {
    if (!this.thinkingContent) return undefined;
    return { content: this.thinkingContent, duration: this.thinkingDuration };
  }

  private async waitForImageUploads(): Promise<ChatImageItem[]> {
    if (this.uploadTasks.size === 0) return [];

    try {
      const results = await pMap(Array.from(this.uploadTasks.values()), (task) => task, {
        concurrency: 5,
      });
      return results.filter((i) => !!i.url) as ChatImageItem[];
    } catch (error) {
      console.error('Error waiting for image uploads:', error);
      return [];
    }
  }

  private async waitForMultimodalUploads(): Promise<void> {
    await Promise.allSettled([
      ...Array.from(this.contentImageUploads.values()),
      ...Array.from(this.reasoningImageUploads.values()),
    ]);
  }

  private processFinalToolCalls(toolCalls?: MessageToolCall[]): void {
    if (!toolCalls?.length) return;

    this.throttledUpdateToolCalls.flush();
    this.callbacks.toggleToolCallingStreaming(this.context.messageId, undefined);

    const processedToolCalls = toolCalls.map((item) => ({
      ...item,
      function: {
        ...item.function,
        arguments: item.function.arguments || '{}',
      },
    }));

    this.tools = this.callbacks.transformToolCalls(processedToolCalls);
    this.isFunctionCall = true;
  }

  private buildFinalResult(finishData: FinishData, finalImages: ChatImageItem[]): StreamingResult {
    const hasContentImages = this.contentParts.some((p) => p.type === 'image');
    const hasReasoningImages = this.reasoningParts.some((p) => p.type === 'image');

    // Determine final content
    const finalContent = hasContentImages
      ? serializePartsForStorage(this.contentParts)
      : this.output;

    // Determine final reasoning content
    const finalDuration =
      this.thinkingDuration && !isNaN(this.thinkingDuration) ? this.thinkingDuration : undefined;

    // Get signature from finishData.reasoning (provided by backend in onFinish)
    const reasoningSignature = finishData.reasoning?.signature;

    let finalReasoning: ReasoningState | undefined;
    if (hasReasoningImages) {
      finalReasoning = {
        content: serializePartsForStorage(this.reasoningParts),
        duration: finalDuration,
        isMultimodal: true,
        signature: reasoningSignature,
      };
    } else if (this.thinkingContent) {
      finalReasoning = {
        content: this.thinkingContent,
        duration: finalDuration,
        signature: reasoningSignature,
      };
    } else if (finishData.reasoning?.content) {
      finalReasoning = {
        ...finishData.reasoning,
        duration: finalDuration,
      };
    }

    this.finishType = finishData.type;

    log(
      '[handleFinish] messageId=%s, finishType=%s, operationId=%s',
      this.context.messageId,
      finishData.type,
      this.context.operationId,
    );

    return {
      content: finalContent,
      finishType: finishData.type,
      isFunctionCall: this.isFunctionCall,
      metadata: {
        finishType: finishData.type,
        imageList: finalImages.length > 0 ? finalImages : undefined,
        isMultimodal: hasContentImages || undefined,
        performance: finishData.speed,
        reasoning: finalReasoning,
        search: finishData.grounding?.citations ? finishData.grounding : undefined,
        usage: finishData.usage,
      },
      toolCalls: finishData.toolCalls,
      tools: this.tools,
      traceId: this.msgTraceId,
      usage: finishData.usage,
    };
  }
}
