import type { AgentEvent } from '@lobechat/agent-runtime';
import type { Base64ImageData, ContentPartData } from '@lobechat/model-runtime';

import { fileEnv } from '@/envs/file';
import { FileService } from '@/server/services/file';
import { nanoid } from '@/utils/uuid';

import type { RuntimeExecutorContext } from '../context';
import { log, timing } from '../executorHelpers';

export type ServerCallLlmContentPart =
  { image: string; type: 'image' } | { text: string; type: 'text' };

interface CreateServerCallLlmStreamSinkInput {
  ctx: RuntimeExecutorContext;
  events: AgentEvent[];
  operationLogId: string;
}

const BUFFER_INTERVAL = 300;

const appendTextPart = (parts: ServerCallLlmContentPart[], text: string) => {
  const last = parts.at(-1);
  if (last && last.type === 'text') {
    parts[parts.length - 1] = { text: last.text + text, type: 'text' };
  } else {
    parts.push({ text, type: 'text' });
  }
};

export class ServerCallLlmStreamSink {
  content = '';
  readonly contentImageUploads: Promise<void>[] = [];
  readonly contentParts: ServerCallLlmContentPart[] = [];
  hasContentImages = false;
  hasReasoningImages = false;
  readonly reasoningImageUploads: Promise<void>[] = [];
  readonly reasoningParts: ServerCallLlmContentPart[] = [];
  thinkingContent = '';

  private readonly events: AgentEvent[];
  private readonly imageUploadDate = new Date().toISOString().split('T')[0];
  private readonly imageUploadService?: FileService;
  private readonly operationId: string;
  private readonly operationLogId: string;
  private reasoningBuffer = '';
  private reasoningBufferTimer: NodeJS.Timeout | null = null;
  private readonly stepIndex: number;
  private textBuffer = '';
  private textBufferTimer: NodeJS.Timeout | null = null;

  constructor({ ctx, events, operationLogId }: CreateServerCallLlmStreamSinkInput) {
    this.events = events;
    this.operationId = ctx.operationId;
    this.operationLogId = operationLogId;
    this.stepIndex = ctx.stepIndex;
    // File service + date shard used to persist model-generated images
    // (Gemini multimodal `content_part`/`reasoning_part` images) to object
    // storage, built once and reused across parts. The `userId` check only
    // satisfies its optional type — it is always present in this executor.
    // A missing-S3-config failure surfaces later at uploadBase64 (caught per
    // image in uploadPartImage), never at construction.
    this.imageUploadService = ctx.userId ? new FileService(ctx.serverDB, ctx.userId) : undefined;
    this.streamManager = ctx.streamManager;
  }

  private readonly streamManager: RuntimeExecutorContext['streamManager'];

  async appendContentPart(part: ContentPartData) {
    if (part.partType === 'image') {
      const partIndex = this.contentParts.length;
      this.contentParts.push({
        image: `data:${part.mimeType || 'image/png'};base64,${part.content}`,
        type: 'image',
      });
      this.hasContentImages = true;
      this.contentImageUploads.push(
        this.uploadPartImage(this.contentParts, partIndex, part.content, part.mimeType),
      );
      return;
    }

    this.content += part.content;
    appendTextPart(this.contentParts, part.content);
    this.queueText(part.content);
  }

  async appendReasoningPart(part: ContentPartData) {
    if (part.partType === 'image') {
      const partIndex = this.reasoningParts.length;
      this.reasoningParts.push({
        image: `data:${part.mimeType || 'image/png'};base64,${part.content}`,
        type: 'image',
      });
      this.hasReasoningImages = true;
      this.reasoningImageUploads.push(
        this.uploadPartImage(this.reasoningParts, partIndex, part.content, part.mimeType),
      );
      return;
    }

    this.thinkingContent += part.content;
    appendTextPart(this.reasoningParts, part.content);
    this.queueReasoning(part.content);
  }

  async appendText(text: string) {
    this.content += text;
    this.queueText(text);
  }

  async appendThinking(reasoning: string) {
    this.thinkingContent += reasoning;
    this.queueReasoning(reasoning);
  }

  async appendBase64Image(image: Base64ImageData) {
    // `image.data` is a full data URI (`data:<mime>;base64,<...>`).
    const mimeType = /^data:([^;]+);/.exec(image.data)?.[1];
    const partIndex = this.contentParts.length;
    this.contentParts.push({ image: image.data, type: 'image' });
    this.hasContentImages = true;
    this.contentImageUploads.push(
      this.uploadPartImage(this.contentParts, partIndex, image.data, mimeType),
    );
  }

  clearBuffers() {
    if (this.textBufferTimer) {
      clearTimeout(this.textBufferTimer);
      this.textBufferTimer = null;
    }

    if (this.reasoningBufferTimer) {
      clearTimeout(this.reasoningBufferTimer);
      this.reasoningBufferTimer = null;
    }

    this.textBuffer = '';
    this.reasoningBuffer = '';
  }

  async flushReasoningBuffer() {
    const delta = this.reasoningBuffer;

    this.reasoningBuffer = '';

    if (!!delta) {
      log(`[${this.operationLogId}] flushReasoningBuffer:`, delta);

      this.events.push({
        chunk: { text: delta, type: 'reasoning' },
        type: 'llm_stream',
      });

      const publishStart = Date.now();
      await this.streamManager.publishStreamChunk(this.operationId, this.stepIndex, {
        chunkType: 'reasoning',
        reasoning: delta,
      });
      timing(
        '[%s] flushReasoningBuffer published at %d, took %dms, length: %d',
        this.operationLogId,
        publishStart,
        Date.now() - publishStart,
        delta.length,
      );
    }
  }

  async flushTextBuffer() {
    const delta = this.textBuffer;
    this.textBuffer = '';

    if (!!delta) {
      log(`[${this.operationLogId}] flushTextBuffer:`, delta);

      // Build standard Agent Runtime event
      this.events.push({
        chunk: { text: delta, type: 'text' },
        type: 'llm_stream',
      });

      const publishStart = Date.now();
      await this.streamManager.publishStreamChunk(this.operationId, this.stepIndex, {
        chunkType: 'text',
        content: delta,
      });
      timing(
        '[%s] flushTextBuffer published at %d, took %dms, length: %d',
        this.operationLogId,
        publishStart,
        Date.now() - publishStart,
        delta.length,
      );
    }
  }

  async waitForImageUploads() {
    if (this.contentImageUploads.length > 0 || this.reasoningImageUploads.length > 0) {
      await Promise.allSettled([...this.contentImageUploads, ...this.reasoningImageUploads]);
    }
  }

  private queueReasoning(reasoning: string) {
    this.reasoningBuffer += reasoning;

    if (!this.reasoningBufferTimer) {
      this.reasoningBufferTimer = setTimeout(async () => {
        await this.flushReasoningBuffer();
        this.reasoningBufferTimer = null;
      }, BUFFER_INTERVAL);
    }
  }

  private queueText(text: string) {
    this.textBuffer += text;

    if (!this.textBufferTimer) {
      this.textBufferTimer = setTimeout(async () => {
        await this.flushTextBuffer();
        this.textBufferTimer = null;
      }, BUFFER_INTERVAL);
    }
  }

  private uploadPartImage(
    parts: ServerCallLlmContentPart[],
    partIndex: number,
    base64: string,
    mimeType: string | undefined,
  ): Promise<void> {
    if (!this.imageUploadService) return Promise.resolve();
    const ext = mimeType?.split('/')[1] || 'png';
    const pathname = `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/generations/${this.imageUploadDate}/${nanoid()}.${ext}`;
    return this.imageUploadService
      .uploadBase64(base64, pathname)
      .then(({ url }) => {
        parts[partIndex] = { image: url, type: 'image' };
      })
      .catch((error) => {
        console.error(`[${this.operationLogId}][content_part] image upload failed:`, error);
      });
  }
}

export const createServerCallLlmStreamSink = (input: CreateServerCallLlmStreamSinkInput) =>
  new ServerCallLlmStreamSink(input);
