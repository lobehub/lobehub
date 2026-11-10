import type {
  LocalAsrJobProgressPayload,
  LocalAsrLanguage,
  LocalAsrRealtimeEvent,
  MainBroadcastEventKey,
  MainBroadcastParams,
} from '@lobechat/electron-client-ipc';

import { electronLocalAsrService } from '@/services/electron/localAsr';

import type {
  BatchTranscriber,
  BatchTranscriptionInput,
  BatchTranscriptionResult,
  RealtimeTranscriber,
  RealtimeTranscriberResult,
  RealtimeTranscriberStartOptions,
} from './transcriber';

type Subscribe = <T extends MainBroadcastEventKey>(
  event: T,
  listener: (data: MainBroadcastParams<T>) => void,
) => () => void;

const subscribeBroadcast: Subscribe = (event, listener) => {
  if (typeof window === 'undefined' || !window.electron) return () => {};
  return window.electron.ipcRenderer.on(event, (_event, data) => listener(data));
};

interface LocalTranscriberDeps {
  service?: Pick<
    typeof electronLocalAsrService,
    'cancelSession' | 'pushAudio' | 'startSession' | 'stopSession' | 'transcribeFile'
  >;
  subscribe?: Subscribe;
}

/**
 * Realtime transcription on this device: frames go renderer → main → the
 * sherpa-onnx utility process over IPC; nothing is sent over the network.
 */
export class LocalRealtimeTranscriber implements RealtimeTranscriber {
  readonly provider = 'local' as const;
  private readonly service: NonNullable<LocalTranscriberDeps['service']>;
  private readonly subscribe: Subscribe;
  private earlyEvents: LocalAsrRealtimeEvent[] = [];
  private options?: RealtimeTranscriberStartOptions;
  private paused = false;
  private queued: ArrayBuffer[] = [];
  private sessionId?: string;
  private unsubscribe?: () => void;

  constructor(deps: LocalTranscriberDeps = {}) {
    this.service = deps.service ?? electronLocalAsrService;
    this.subscribe = deps.subscribe ?? subscribeBroadcast;
  }

  async start(options: RealtimeTranscriberStartOptions) {
    this.options = options;
    // Subscribe first: `session.ready` is emitted before startSession resolves.
    this.unsubscribe = this.subscribe('localAsrEvent', (event) => {
      if (!this.sessionId) this.earlyEvents.push(event);
      else if (event.sessionId === this.sessionId) this.handle(event);
    });

    try {
      const { sessionId } = await this.service.startSession({
        language: options.language as LocalAsrLanguage | undefined,
        recordAudio: options.recordAudio,
      });
      this.sessionId = sessionId;
    } catch (error) {
      this.dispose();
      throw error;
    }

    for (const event of this.earlyEvents)
      if (event.sessionId === this.sessionId) this.handle(event);
    this.earlyEvents = [];
    for (const frame of this.queued) this.send(frame);
    this.queued = [];
  }

  pushFrame(frame: ArrayBuffer) {
    if (this.paused) return;
    if (!this.sessionId) {
      this.queued.push(frame);
      return;
    }
    this.send(frame);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  async stop(): Promise<RealtimeTranscriberResult> {
    if (!this.sessionId) {
      this.dispose();
      return {};
    }
    try {
      return await this.service.stopSession({ sessionId: this.sessionId });
    } finally {
      // Let the trailing final (emitted just before the stop response) reach the handler.
      await Promise.resolve();
      this.dispose();
    }
  }

  async cancel() {
    const sessionId = this.sessionId;
    this.dispose();
    if (sessionId) await this.service.cancelSession({ sessionId });
  }

  private send(frame: ArrayBuffer) {
    void this.service
      .pushAudio({ frame: new Uint8Array(frame), sessionId: this.sessionId! })
      .catch((error: Error) =>
        this.options?.onError?.({
          code: 'INTERNAL_ERROR',
          message: error.message,
          retryable: true,
        }),
      );
  }

  private handle(event: LocalAsrRealtimeEvent) {
    switch (event.type) {
      case 'transcript.partial':
      case 'transcript.final': {
        const segment = {
          endMs: event.endMs,
          id: event.segmentId,
          startMs: event.startMs,
          text: event.text,
        };
        if (event.type === 'transcript.final') this.options?.onFinal(segment);
        else this.options?.onPartial?.(segment);
        return;
      }
      case 'session.error': {
        this.options?.onError?.({
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        });
        return;
      }
    }
  }

  private dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.sessionId = undefined;
    this.queued = [];
    this.earlyEvents = [];
  }
}

/** Refine a local recording on this device, optionally with speaker diarization. */
export class LocalBatchTranscriber implements BatchTranscriber {
  readonly provider = 'local' as const;
  private readonly service: NonNullable<LocalTranscriberDeps['service']>;
  private readonly subscribe: Subscribe;

  constructor(deps: LocalTranscriberDeps = {}) {
    this.service = deps.service ?? electronLocalAsrService;
    this.subscribe = deps.subscribe ?? subscribeBroadcast;
  }

  async transcribe(input: BatchTranscriptionInput): Promise<BatchTranscriptionResult> {
    const jobId = crypto.randomUUID();
    const unsubscribe = input.onProgress
      ? this.subscribe('localAsrJobProgress', (payload: LocalAsrJobProgressPayload) => {
          if (payload.jobId === jobId) input.onProgress?.(payload);
        })
      : undefined;

    try {
      const result = await this.service.transcribeFile({
        diarize: input.diarize,
        filePath: input.filePath,
        jobId,
        language: input.language as LocalAsrLanguage | undefined,
      });
      return {
        audioMs: result.audioMs,
        segments: result.segments,
        speakers: result.speakers,
        stats: result.stats,
      };
    } finally {
      unsubscribe?.();
    }
  }
}
