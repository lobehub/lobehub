import {
  parseRealtimeAsrServerEvent,
  REALTIME_ASR_PROTOCOL_VERSION,
  type RealtimeAsrSessionResponse,
  RealtimeDictationError,
} from '@/features/ChatInput/Dictation/contract';
import { BoundedWebSocketFrameQueue } from '@/features/ChatInput/Dictation/frameQueue';
import { createRealtimeAsrSession } from '@/features/ChatInput/Dictation/service';

import type {
  RealtimeTranscriber,
  RealtimeTranscriberResult,
  RealtimeTranscriberStartOptions,
} from './transcriber';

export interface CloudSocket {
  addEventListener: (
    type: 'close' | 'error' | 'message' | 'open',
    listener: (event: any) => void,
  ) => void;
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  close: (code?: number, reason?: string) => void;
  readonly readyState: number;
  send: (data: ArrayBuffer | string) => void;
}

interface CloudTranscriberDeps {
  createSession?: (signal: AbortSignal) => Promise<RealtimeAsrSessionResponse>;
  createSocket?: (url: string) => CloudSocket;
}

const SOCKET_OPEN = 1;

/**
 * Cloud realtime transcription over the LobeHub realtime ASR v1 protocol
 * (`/webapi/asr/realtime/session` + WebSocket). One protocol session is capped
 * at `limits.maxSessionMs` (60 s); rotating sessions for long meetings belongs
 * to the meeting recorder, which can swap transcribers behind this interface.
 */
export class CloudRealtimeTranscriber implements RealtimeTranscriber {
  readonly provider = 'cloud' as const;
  private readonly createSession: NonNullable<CloudTranscriberDeps['createSession']>;
  private readonly createSocket: NonNullable<CloudTranscriberDeps['createSocket']>;
  private abort?: AbortController;
  private completed?: { reject: (error: Error) => void; resolve: (audioMs: number) => void };
  private options?: RealtimeTranscriberStartOptions;
  private paused = false;
  private pending: ArrayBuffer[] = [];
  private queue?: BoundedWebSocketFrameQueue;
  private segments = 0;
  private socket?: CloudSocket;

  constructor(deps: CloudTranscriberDeps = {}) {
    this.createSession = deps.createSession ?? ((signal) => createRealtimeAsrSession(signal));
    this.createSocket =
      deps.createSocket ?? ((url) => new WebSocket(url) as unknown as CloudSocket);
  }

  async start(options: RealtimeTranscriberStartOptions) {
    this.options = options;
    this.abort = new AbortController();
    const session = await this.createSession(this.abort.signal);
    const socket = this.createSocket(session.websocketUrl);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () =>
        socket.send(
          JSON.stringify({
            protocolVersion: REALTIME_ASR_PROTOCOL_VERSION,
            token: session.token,
            type: 'session.auth',
          }),
        ),
      );
      socket.addEventListener('error', () =>
        reject(new RealtimeDictationError('NETWORK_DISCONNECTED', true)),
      );
      socket.addEventListener('message', (message: MessageEvent) => {
        let event;
        try {
          event = parseRealtimeAsrServerEvent(message.data);
        } catch (error) {
          this.fail(error as RealtimeDictationError);
          reject(error);
          return;
        }
        switch (event.type) {
          case 'session.ready': {
            this.queue = new BoundedWebSocketFrameQueue(socket, {
              maxFrames: session.limits.maxBufferedFrames,
            });
            for (const frame of this.pending) this.queue.enqueue(frame);
            this.pending = [];
            resolve();
            return;
          }
          case 'transcript.partial': {
            this.options?.onPartial?.({ id: event.segmentId, text: event.text });
            return;
          }
          case 'transcript.final': {
            this.segments += 1;
            this.options?.onFinal({ id: event.segmentId, text: event.text });
            return;
          }
          case 'session.completed':
          case 'session.cancelled': {
            this.completed?.resolve(event.forwardedAudioMs);
            this.close();
            return;
          }
          case 'session.error': {
            const error = new RealtimeDictationError(event.code, event.retryable);
            this.fail(error);
            reject(error);
          }
        }
      });
    });
  }

  pushFrame(frame: ArrayBuffer) {
    if (this.paused) return;
    if (!this.queue) {
      this.pending.push(frame);
      return;
    }
    if (!this.queue.enqueue(frame)) this.fail(new RealtimeDictationError('BACKPRESSURE', true));
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  async stop(): Promise<RealtimeTranscriberResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      this.close();
      return {};
    }
    await this.queue?.waitForEmpty(1000).catch(() => undefined);
    const audioMs = await new Promise<number>((resolve, reject) => {
      this.completed = { reject, resolve };
      socket.send(JSON.stringify({ type: 'session.end' }));
    });
    return { stats: { audioMs, segments: this.segments } };
  }

  async cancel() {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.socket.send(JSON.stringify({ reason: 'user_cancelled', type: 'session.cancel' }));
    }
    this.close();
  }

  private fail(error: RealtimeDictationError) {
    this.options?.onError?.({ code: error.code, retryable: error.retryable });
    this.completed?.reject(error);
    this.close();
  }

  private close() {
    this.abort?.abort();
    this.queue?.dispose();
    this.queue = undefined;
    this.socket?.close();
    this.socket = undefined;
  }
}
