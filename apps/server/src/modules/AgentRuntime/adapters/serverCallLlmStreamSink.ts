import type { AgentEvent, BlobStore, LLMAttemptContentPart } from '@lobechat/agent-runtime';
import type { Base64ImageData, ContentPartData } from '@lobechat/model-runtime';
import type { ChatToolPayload } from '@lobechat/types';

import { fileEnv } from '@/envs/file';
import { nanoid } from '@/utils/uuid';

import type { RuntimeExecutorContext } from '../context';
import { log, timing } from '../executorHelpers';

export type ServerCallLlmContentPart = LLMAttemptContentPart;

interface CreateServerCallLlmStreamSinkInput {
  blobStore?: BlobStore;
  ctx: RuntimeExecutorContext;
  events: AgentEvent[];
  operationLogId: string;
}

const BUFFER_INTERVAL = 300;

/**
 * Throttle window for `tools_calling` chunks.
 *
 * Providers stream tool-call arguments delta by delta (roughly one per token),
 * and `parseToolCalls` re-emits the WHOLE accumulated call list every time — so
 * an unthrottled publish costs one `XADD` + one `EXPIRE` round trip plus a
 * Gateway POST per token, carrying a payload that grows with every delta. On a
 * tool call with a few KB of arguments that is thousands of Redis commands and
 * quadratic bytes, awaited inline in the provider stream: the visible symptom is
 * a stalled, stuttering stream. Beyond the cost, the Gateway push lane drops
 * events once `MAX_INFLIGHT` is reached, so flooding it also loses OTHER
 * chunks (text deltas, which are NOT idempotent) off the live WebSocket path.
 *
 * Dropping intermediate frames is lossless here because `tools_calling` is a
 * full SNAPSHOT, not a delta: the client replaces the message's `tools` array
 * wholesale on every chunk. Only the newest snapshot matters, and the trailing
 * flush always ships the final one.
 */
const TOOLS_CALLING_THROTTLE_INTERVAL = BUFFER_INTERVAL;

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

  private readonly blobStore?: BlobStore;
  private readonly events: AgentEvent[];
  private readonly imageUploadDate = new Date().toISOString().split('T')[0];
  private readonly operationId: string;
  private readonly operationLogId: string;
  private reasoningBuffer = '';
  private reasoningBufferTimer: NodeJS.Timeout | null = null;
  private readonly stepIndex: number;
  private textBuffer = '';
  private textBufferTimer: NodeJS.Timeout | null = null;
  /** In-flight `tools_calling` publish; settles rather than rejects. */
  private toolsCallingFlush: Promise<void> | null = null;
  /** Latest un-published `tools_calling` snapshot; `undefined` once flushed. */
  private toolsCallingSnapshot: ChatToolPayload[] | undefined;
  private toolsCallingTimer: NodeJS.Timeout | null = null;

  constructor({ blobStore, ctx, events, operationLogId }: CreateServerCallLlmStreamSinkInput) {
    this.blobStore = blobStore;
    this.events = events;
    this.operationId = ctx.operationId;
    this.operationLogId = operationLogId;
    this.stepIndex = ctx.stepIndex;
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

  /**
   * Queue a `tools_calling` snapshot for a throttled publish. Mirrors
   * {@link queueText}: the timer stays armed across its own flush, so deltas
   * arriving during a slow publish collapse into the snapshot instead of
   * starting a second one. See {@link TOOLS_CALLING_THROTTLE_INTERVAL}.
   */
  queueToolsCalling(toolsCalling: ChatToolPayload[]) {
    this.toolsCallingSnapshot = toolsCalling;

    if (!this.toolsCallingTimer) {
      this.toolsCallingTimer = setTimeout(async () => {
        // The throttled publish runs detached from the provider stream, so a
        // failure here has no caller to reject into. Swallow it: the snapshot is
        // restored by the flush and the end-of-stream flush republishes it.
        try {
          await this.flushToolsCallingBuffer();
        } catch (error) {
          log(`[${this.operationLogId}] throttled tools_calling publish failed:`, error);
        }
        this.toolsCallingTimer = null;
      }, TOOLS_CALLING_THROTTLE_INTERVAL);
    }
  }

  async flushToolsCallingBuffer() {
    // Join an in-flight publish before taking the snapshot. The throttle timer
    // stays armed across its own flush, so the only possible overlap is with
    // this method called directly (the attempt's end-of-stream flush); joining
    // keeps snapshots strictly ordered and makes that final call a real barrier
    // rather than a no-op that leaves a publish floating past the attempt.
    if (this.toolsCallingFlush) await this.toolsCallingFlush;

    const snapshot = this.toolsCallingSnapshot;
    this.toolsCallingSnapshot = undefined;

    if (!snapshot) return;

    log(`[${this.operationLogId}] flushToolsCallingBuffer:`, snapshot.length);

    const publishStart = Date.now();
    const publish = this.streamManager.publishStreamChunk(this.operationId, this.stepIndex, {
      chunkType: 'tools_calling',
      toolsCalling: snapshot,
    });
    // Settle-only handle for joiners: never rejects, so awaiting it is safe and
    // the failure is handled once, below, by the caller that owns the publish.
    const joinable = publish.then(
      () => {},
      () => {},
    );
    this.toolsCallingFlush = joinable;

    try {
      await publish;
      timing(
        '[%s] flushToolsCallingBuffer published at %d, took %dms, calls: %d',
        this.operationLogId,
        publishStart,
        Date.now() - publishStart,
        snapshot.length,
      );
    } catch (error) {
      // Put the snapshot back (unless a newer one landed) so the attempt's
      // end-of-stream flush republishes it. Without this a failed throttled
      // publish could silently drop the FINAL tool-call payload, which the
      // unthrottled code path could never do.
      if (!this.toolsCallingSnapshot) this.toolsCallingSnapshot = snapshot;
      throw error;
    } finally {
      if (this.toolsCallingFlush === joinable) this.toolsCallingFlush = null;
    }
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

    if (this.toolsCallingTimer) {
      clearTimeout(this.toolsCallingTimer);
      this.toolsCallingTimer = null;
    }

    this.textBuffer = '';
    this.reasoningBuffer = '';
    this.toolsCallingSnapshot = undefined;
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
    if (!this.blobStore) return Promise.resolve();
    const ext = mimeType?.split('/')[1] || 'png';
    const pathname = `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/generations/${this.imageUploadDate}/${nanoid()}.${ext}`;
    return this.blobStore
      .persistBase64(base64, pathname)
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
