import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { rewriteImagePlaceholders, type UploadedImageOutcome } from '../imageEcho';
import { createAdapter } from '../registry';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousToolResultImage,
  PostRunUsageOptions,
  UsageData,
} from '../types';
import { CodexFileChangeTracker } from './codexFileChangeTracker';
import { createCodexImageOutputReader } from './codexImageOutputs';
import { readImageDimensions } from './imageDimensions';
import { JsonlStreamProcessor } from './jsonlProcessor';
import { readPostRunUsage } from './postRunUsage';
import { toStreamEvent } from './streamEvent';

/**
 * Runtime-side hook that uploads a base64 image echoed by a tool_result to the
 * file store and returns its reference. Injected by whichever runtime actually
 * spawns the CLI (desktop main / `lh hetero exec`), because only they hold the
 * authenticated file-store client. Return `undefined` (or throw) to signal the
 * upload could not be done — the pipeline drops the image and leaves the
 * `[Image: …]` text placeholder as the fallback.
 */
export type UploadHeterogeneousImage = (image: {
  data: string;
  height?: number;
  mediaType: string;
  width?: number;
}) => Promise<{ fileId: string; url: string } | undefined>;

export interface AgentStreamPipelineOptions {
  /** Agent type key (e.g. `claude-code`, `codex`). */
  agentType: string;
  /** Working directory used to resolve relative file paths emitted by CLI tools. */
  cwd?: string;
  /** Environment of the spawned CLI, including its CODEX_HOME. */
  env?: Record<string, string | undefined>;
  /** Last known Codex cumulative usage before a resumed turn starts. */
  initialCumulativeUsage?: UsageData | undefined;
  /** Host-known model to emit before the CLI's first stdout payload. */
  initialModel?: string | undefined;
  /** Operation id to stamp onto every emitted `AgentStreamEvent`. */
  operationId: string;
  /** Invocation start, recorded before spawning the CLI. */
  startedAt?: number;
  /**
   * Uploader for tool_result images. When omitted, `pluginState.images` base64
   * entries are dropped (the `[Image: …]` content placeholder is the fallback)
   * so heavy base64 never reaches persistence.
   */
  uploadImage?: UploadHeterogeneousImage;
}

/**
 * Producer-side pipeline that converts CLI stdout chunks into
 * `AgentStreamEvent` batches. Composes the building blocks the
 * heterogeneous-agent contract requires:
 *
 *   stdout chunk → JsonlStreamProcessor → (codex tracker, if applicable) → adapter → toStreamEvent
 *
 * Both the desktop main process and the future `lh hetero exec` CLI feed
 * stdout into this pipeline so consumers (renderer / server) only ever see a
 * single, unified wire shape. Codex's file-change diff/stat enrichment is
 * baked in here so consumers don't need to know it exists.
 */
export class AgentStreamPipeline {
  private readonly processor = new JsonlStreamProcessor();
  private readonly adapter: AgentEventAdapter;
  private readonly agentType: string;
  private readonly operationId: string;
  private readonly codexTracker?: CodexFileChangeTracker;
  private readonly uploadImage?: UploadHeterogeneousImage;
  private readonly readCodexImages: ReturnType<typeof createCodexImageOutputReader>;
  private recoveredCodexImageCallIds = new Set<string>();
  private queuedEvents: AgentStreamEvent[] = [];

  constructor(options: AgentStreamPipelineOptions) {
    this.adapter = createAdapter(options.agentType);
    this.agentType = options.agentType;
    this.readCodexImages = createCodexImageOutputReader({
      env: options.env ?? process.env,
      startedAt: options.startedAt ?? Date.now(),
    });
    this.operationId = options.operationId;
    this.uploadImage = options.uploadImage;
    this.codexTracker =
      options.agentType === 'codex' ? new CodexFileChangeTracker(options.cwd) : undefined;

    if (options.initialModel || options.initialCumulativeUsage) {
      this.queuedEvents.push(
        ...this.configureSession({
          initialCumulativeUsage: options.initialCumulativeUsage,
          model: options.initialModel,
        }),
      );
    }
  }

  /** CC/Codex session id extracted by the underlying adapter (`adapter.sessionId`). */
  get sessionId(): string | undefined {
    return this.adapter.sessionId;
  }

  /**
   * Push a stdout chunk through the pipeline. Resolves with the resulting
   * `AgentStreamEvent` batch in arrival order. Async because the codex
   * tracker reads pre-edit file snapshots from disk for diffs and line stats.
   */
  async push(chunk: Buffer | string): Promise<AgentStreamEvent[]> {
    return this.processPayloads(this.processor.push(chunk));
  }

  /**
   * Drain any trailing buffered line + flush adapter-buffered events. Call
   * when the upstream stdout stream emits `end`.
   */
  async flush(): Promise<AgentStreamEvent[]> {
    const trailing = await this.processPayloads(this.processor.flush());
    const recovered = await this.recoverCodexImages();
    const flushedEvents = [...recovered, ...this.adapter.flush()];
    await this.uploadResultImages(flushedEvents);
    const flushed = flushedEvents.map((event) => toStreamEvent(event, this.operationId));
    return [...trailing, ...flushed];
  }

  configureSession(data: {
    initialCumulativeUsage?: UsageData | undefined;
    model?: string | undefined;
  }): AgentStreamEvent[] {
    return this.toStreamEvents(
      this.adapter.adapt({
        ...data,
        type: 'session_configured',
      }),
    );
  }

  completeRuntime(data: Record<string, any> = {}): AgentStreamEvent[] {
    return this.toStreamEvents([
      {
        data,
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'agent_runtime_end',
      },
    ]);
  }

  /**
   * Read usage the CLI only wrote to disk (Kimi Code's session wire log) and
   * let the adapter turn it into events. Call after {@link flush} and process
   * exit. Always best-effort: agents without post-run usage, a missing log, or
   * a failing read yield `[]`.
   */
  async collectPostRunUsage(options?: PostRunUsageOptions): Promise<AgentStreamEvent[]> {
    if (!this.adapter.buildPostRunUsageEvents) return [];
    try {
      const usage = await readPostRunUsage(this.agentType, this.adapter.sessionId, options);
      if (!usage) return [];
      return this.toStreamEvents(this.adapter.buildPostRunUsageEvents(usage));
    } catch {
      return [];
    }
  }

  /**
   * Validate provider-specific terminal contracts after a successful process
   * exit. Call only after {@link flush} has drained the full stdout stream.
   */
  validateCompletion(): AgentStreamEvent[] {
    return this.toStreamEvents(this.adapter.validateCompletion?.() ?? []);
  }

  private async processPayloads(payloads: unknown[]): Promise<AgentStreamEvent[]> {
    const out: AgentStreamEvent[] = this.drainQueuedEvents();

    for (const raw of payloads) {
      const payload = this.codexTracker ? await this.codexTracker.track(raw as any) : raw;
      const rawEvent = payload as { item?: { type?: string }; type?: string };
      const recoverImages =
        rawEvent?.type === 'turn.completed' ||
        rawEvent?.type === 'turn.failed' ||
        (rawEvent?.type === 'item.completed' && rawEvent.item?.type === 'agent_message');
      const recovered = recoverImages ? await this.recoverCodexImages() : [];
      const events = [...recovered, ...this.adapter.adapt(payload)];
      await this.uploadResultImages(events);
      out.push(...this.toStreamEvents(events));
    }

    return out;
  }

  private async recoverCodexImages(): Promise<HeterogeneousAgentEvent[]> {
    if (this.agentType !== 'codex' || !this.adapter.sessionId) return [];
    try {
      const items = await this.readCodexImages(this.adapter.sessionId);
      return items.flatMap((item) => {
        if (this.recoveredCodexImageCallIds.has(item.id)) return [];
        this.recoveredCodexImageCallIds.add(item.id);
        return this.adapter.adapt({ item, type: 'item.completed' });
      });
    } catch (error) {
      console.error('Failed to recover Codex tool images from the session transcript:', error);
      return [];
    }
  }

  /**
   * Rewrite any `tool_result` `pluginState.images` from base64 into uploaded
   * `{ fileId, url }` references, mutating the events in place before they are
   * serialized. Runs on the runtime that spawned the CLI (the only place with
   * an authenticated file-store client), so the heavy base64 never reaches the
   * persistence sinks. Uploads that fail — or that have no injected uploader —
   * drop the image entry; the `[Image: …]` text placeholder is the fallback.
   *
   * On success it also rewrites the matching `[Image: …]` placeholder in the
   * tool_result `content` into a markdown image, so a downstream model handed
   * this history (e.g. a summarizer, or continuing the topic on another model)
   * knows an image is here and where — not just an opaque token.
   */
  private async uploadResultImages(events: HeterogeneousAgentEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type !== 'tool_result') continue;
      const pluginState = event.data?.pluginState as Record<string, any> | undefined;
      const images = pluginState?.images as HeterogeneousToolResultImage[] | undefined;
      if (!images?.length) continue;

      const uploaded: HeterogeneousToolResultImage[] = [];
      // One entry per original image, in emission order, so the content
      // placeholders can be rewritten position-for-position (a failed upload
      // leaves its `url` unset → its placeholder is kept).
      const outcomes: UploadedImageOutcome[] = [];
      for (const image of images) {
        // Already an uploaded reference (or nothing to upload) — pass through.
        if (!image.data || image.fileId) {
          uploaded.push(image);
          outcomes.push({ mediaType: image.mediaType, url: image.url });
          continue;
        }
        if (!this.uploadImage) {
          outcomes.push({ mediaType: image.mediaType });
          continue;
        }
        try {
          // Best-effort: lets renders reserve the image box before it loads.
          const dims = readImageDimensions(image.data);
          const ref = await this.uploadImage({
            data: image.data,
            mediaType: image.mediaType,
            ...dims,
          });
          // `undefined` → uploader declined; drop the entry rather than persist base64.
          if (ref) {
            uploaded.push({
              fileId: ref.fileId,
              mediaType: image.mediaType,
              url: ref.url,
              ...dims,
            });
            outcomes.push({ mediaType: image.mediaType, url: ref.url });
          } else {
            outcomes.push({ mediaType: image.mediaType });
          }
        } catch {
          // Degrade to the `[Image: …]` placeholder rather than failing the stream.
          outcomes.push({ mediaType: image.mediaType });
        }
      }

      if (uploaded.length > 0) pluginState!.images = uploaded;
      else delete pluginState!.images;

      if (typeof event.data?.content === 'string') {
        event.data.content = rewriteImagePlaceholders(event.data.content, outcomes);
      }
    }
  }

  private drainQueuedEvents(): AgentStreamEvent[] {
    const events = this.queuedEvents;
    this.queuedEvents = [];
    return events;
  }

  private toStreamEvents(events: HeterogeneousAgentEvent[]): AgentStreamEvent[] {
    return events.map((event) => toStreamEvent(event, this.operationId));
  }
}
