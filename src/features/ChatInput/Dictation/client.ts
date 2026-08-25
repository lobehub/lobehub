import type { RealtimeAudioCapture } from './audio';
import type {
  RealtimeAsrSessionResponse,
  RealtimeDictationErrorCode,
  RealtimeDictationSnapshot,
} from './contract';
import {
  parseRealtimeAsrServerEvent,
  REALTIME_ASR_PROTOCOL_VERSION,
  RealtimeDictationError,
} from './contract';
import type { DictationEditorAdapter } from './editor';
import { BoundedWebSocketFrameQueue } from './frameQueue';
import { DictationTranscript } from './transcript';

export type DictationCancelReason = 'audio_interruption' | 'network_change' | 'user_cancelled';

export type RealtimeDictationTimingStage =
  'admission' | 'admission_refresh' | 'capture' | 'permission' | 'ws_ready';

export interface RealtimeDictationTiming {
  durationMs: number;
  stage: RealtimeDictationTimingStage;
}

export const REALTIME_DICTATION_PERFORMANCE_MARKS = {
  admission: 'lobe:voice-dictation:admission',
  admission_refresh: 'lobe:voice-dictation:admission_refresh',
  capture: 'lobe:voice-dictation:capture',
  permission: 'lobe:voice-dictation:permission',
  start: 'lobe:voice-dictation:start',
  ws_ready: 'lobe:voice-dictation:ws_ready',
} as const;

export interface RealtimeAsrWebSocket {
  addEventListener: ((type: 'close' | 'error' | 'open', listener: () => void) => void) &
    ((type: 'message', listener: (event: MessageEvent) => void) => void);
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  close: (code?: number, reason?: string) => void;
  readonly readyState: number;
  removeEventListener: ((type: 'close' | 'error' | 'open', listener: () => void) => void) &
    ((type: 'message', listener: (event: MessageEvent) => void) => void);
  send: (data: ArrayBuffer | string) => void;
}

export interface RealtimeDictationDependencies {
  createCapture: (stream: MediaStream) => Promise<RealtimeAudioCapture>;
  createSession: (signal: AbortSignal) => Promise<RealtimeAsrSessionResponse>;
  createWebSocket: (url: string) => RealtimeAsrWebSocket;
  editor: DictationEditorAdapter;
  now?: () => number;
  onTiming?: (timing: RealtimeDictationTiming) => void;
  requestMicrophone: () => Promise<MediaStream>;
  wallClockNow?: () => number;
}

const IDLE_SNAPSHOT: RealtimeDictationSnapshot = {
  retryable: false,
  status: 'idle',
};

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const ADMISSION_EXPIRY_SAFETY_MS = 1000;

const getMonotonicNow = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

const clearPerformanceMarks = () => {
  if (typeof performance === 'undefined' || typeof performance.clearMarks !== 'function') return;

  try {
    for (const mark of Object.values(REALTIME_DICTATION_PERFORMANCE_MARKS)) {
      performance.clearMarks(mark);
    }
  } catch (error) {
    void error;
  }
};

const markPerformance = (stage: RealtimeDictationTimingStage | 'start') => {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;

  const mark = REALTIME_DICTATION_PERFORMANCE_MARKS[stage];
  try {
    performance.mark(mark);
  } catch (error) {
    void error;
  }
};

const stopMediaStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

const toClientError = (error: unknown): RealtimeDictationError => {
  if (error instanceof RealtimeDictationError) return error;
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new RealtimeDictationError('MICROPHONE_PERMISSION_DENIED', true);
  }
  if (
    error instanceof Error &&
    (error.message === 'microphone_not_supported' ||
      error.message === 'audio_worklet_not_supported')
  ) {
    return new RealtimeDictationError('MICROPHONE_NOT_SUPPORTED', false);
  }
  if (error instanceof Error && error.message === 'frame_queue_timeout') {
    return new RealtimeDictationError('BACKPRESSURE', true);
  }
  return new RealtimeDictationError('AUDIO_CAPTURE_FAILED', true);
};

export class RealtimeDictationClient {
  readonly #dependencies: RealtimeDictationDependencies;
  readonly #subscribers = new Set<() => void>();
  #acceptingAudio = false;
  #abortController?: AbortController;
  #capture?: RealtimeAudioCapture;
  #closingSocket = false;
  #connectTimer?: ReturnType<typeof setTimeout>;
  #editorFinalized = false;
  #finalTimer?: ReturnType<typeof setTimeout>;
  #lifecycleCleanup?: () => void;
  #microphoneStream?: MediaStream;
  #queue?: BoundedWebSocketFrameQueue;
  #runId = 0;
  #session?: RealtimeAsrSessionResponse;
  #snapshot = IDLE_SNAPSHOT;
  #socket?: RealtimeAsrWebSocket;
  #startedAt?: number;
  #terminalTransition = false;
  #transcript?: DictationTranscript;

  constructor(dependencies: RealtimeDictationDependencies) {
    this.#dependencies = dependencies;
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  };

  async start() {
    if (this.#snapshot.status !== 'idle' && this.#snapshot.status !== 'error') return;

    const startedAt = this.#now();
    clearPerformanceMarks();
    markPerformance('start');
    await this.#releaseResources();
    this.#startedAt = startedAt;
    const runId = ++this.#runId;
    this.#editorFinalized = false;
    this.#terminalTransition = false;
    const anchor = this.#dependencies.editor.begin(() => {
      void this.cancel('audio_interruption');
    });
    if (!anchor) {
      this.#setError('AUDIO_CAPTURE_FAILED', true);
      return;
    }

    this.#setSnapshot({ retryable: false, status: 'requesting_permission' });
    const abortController = new AbortController();
    this.#abortController = abortController;

    try {
      const capturePromise = this.#prepareCapture(runId, abortController);
      const admissionPromise = this.#createSession(runId, abortController.signal);
      const [capture, initialSession] = await Promise.all([capturePromise, admissionPromise]);
      if (runId !== this.#runId) {
        await capture.cancel().catch(() => undefined);
        return;
      }

      let session = initialSession;
      if (this.#isAdmissionExpiring(session)) {
        session = await this.#createSession(runId, abortController.signal, 'admission_refresh');
        if (runId !== this.#runId) return;
        if (this.#isAdmissionExpiring(session)) {
          throw new RealtimeDictationError('SESSION_EXPIRED', true);
        }
      }

      this.#session = session;
      this.#transcript = new DictationTranscript({ ...anchor, sessionId: session.sessionId });
      this.#socket = this.#dependencies.createWebSocket(session.websocketUrl);
      this.#socket.binaryType = 'arraybuffer';
      this.#socket.addEventListener('open', this.#handleOpen);
      this.#socket.addEventListener('message', this.#handleMessage);
      this.#socket.addEventListener('error', this.#handleSocketError);
      this.#socket.addEventListener('close', this.#handleClose);
      this.#connectTimer = setTimeout(
        () => void this.#fail('PROVIDER_TIMEOUT', true),
        session.limits.authTimeoutMs + session.limits.providerConnectTimeoutMs,
      );
      this.#attachLifecycleListeners();
    } catch (error) {
      if (runId !== this.#runId) return;
      const clientError = toClientError(error);
      await this.#fail(clientError.code, clientError.retryable);
    }
  }

  async stop() {
    if (this.#snapshot.status !== 'listening' || !this.#socket || !this.#session) return;

    this.#setSnapshot({ retryable: false, status: 'finalizing' });
    try {
      await this.#capture?.stop();
      this.#acceptingAudio = false;
      await this.#queue?.waitForEmpty(1000);
      if (this.#socket.readyState !== SOCKET_OPEN) {
        throw new RealtimeDictationError('NETWORK_DISCONNECTED', true);
      }
      this.#socket.send(JSON.stringify({ type: 'session.end' }));
      this.#startFinalTimer();
    } catch (error) {
      const clientError = toClientError(error);
      await this.#fail(clientError.code, clientError.retryable);
    }
  }

  async cancel(reason: DictationCancelReason = 'user_cancelled') {
    const statusBeforeCancel = this.#snapshot.status;
    if (statusBeforeCancel === 'idle') return;

    this.#finalizeEditor();
    this.#acceptingAudio = false;
    if (statusBeforeCancel !== 'listening' && statusBeforeCancel !== 'finalizing') {
      await this.#complete();
      return;
    }

    this.#setSnapshot({ retryable: false, status: 'finalizing' });
    await this.#capture?.cancel().catch(() => undefined);
    this.#queue?.dispose();
    if (this.#socket?.readyState === SOCKET_OPEN) {
      this.#socket.send(JSON.stringify({ reason, type: 'session.cancel' }));
      this.#startFinalTimer();
    } else {
      await this.#complete();
    }
  }

  async dispose() {
    ++this.#runId;
    this.#finalizeEditor();
    await this.#releaseResources();
    this.#setSnapshot(IDLE_SNAPSHOT);
  }

  #handleOpen = () => {
    if (!this.#socket || !this.#session) return;
    this.#socket.send(
      JSON.stringify({
        protocolVersion: REALTIME_ASR_PROTOCOL_VERSION,
        token: this.#session.token,
        type: 'session.auth',
      }),
    );
  };

  #handleMessage = (message: MessageEvent) => {
    let event;
    try {
      event = parseRealtimeAsrServerEvent(message.data);
    } catch (error) {
      const clientError = toClientError(error);
      void this.#fail(clientError.code, clientError.retryable);
      return;
    }

    const result = this.#transcript?.accept(event);
    if (!result?.accepted) return;

    switch (event.type) {
      case 'session.ready': {
        if (this.#snapshot.status !== 'connecting' || !this.#socket || !this.#session) return;
        this.#recordTiming('ws_ready');
        if (this.#connectTimer) clearTimeout(this.#connectTimer);
        this.#connectTimer = undefined;
        this.#queue = new BoundedWebSocketFrameQueue(this.#socket, {
          maxFrames: this.#session.limits.maxBufferedFrames,
        });
        this.#acceptingAudio = true;
        void this.#capture
          ?.start(this.#handleAudioFrame, () => {
            void this.#fail('AUDIO_CAPTURE_FAILED', true);
          })
          .then(() => {
            if (!this.#terminalTransition && this.#snapshot.status === 'connecting') {
              this.#setSnapshot({ retryable: false, status: 'listening' });
            }
          })
          .catch((error) => {
            const clientError = toClientError(error);
            void this.#fail(clientError.code, clientError.retryable);
          });
        break;
      }
      case 'transcript.partial':
      case 'transcript.final': {
        if (result.changed) this.#dependencies.editor.render(this.#transcript!.dictatedText);
        break;
      }
      case 'session.completed':
      case 'session.cancelled': {
        this.#finalizeEditor();
        void this.#complete();
        break;
      }
      case 'session.error': {
        void this.#fail(event.code, event.retryable);
        break;
      }
    }
  };

  #handleAudioFrame = (frame: ArrayBuffer) => {
    if (!this.#acceptingAudio) return;
    if (!this.#queue?.enqueue(frame)) void this.#fail('BACKPRESSURE', true);
  };

  #handleSocketError = () => {
    if (!this.#closingSocket) void this.#fail('NETWORK_DISCONNECTED', true);
  };

  #handleClose = () => {
    if (!this.#closingSocket && this.#snapshot.status !== 'idle') {
      void this.#fail('NETWORK_DISCONNECTED', true);
    }
  };

  #attachLifecycleListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handleHidden = () => {
      if (document.visibilityState === 'hidden') void this.cancel('audio_interruption');
    };
    const handleDeviceChange = () => void this.cancel('audio_interruption');
    const handleOffline = () => void this.#fail('NETWORK_DISCONNECTED', true);
    document.addEventListener('visibilitychange', handleHidden);
    window.addEventListener('offline', handleOffline);
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    this.#lifecycleCleanup = () => {
      document.removeEventListener('visibilitychange', handleHidden);
      window.removeEventListener('offline', handleOffline);
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }

  #startFinalTimer() {
    if (this.#finalTimer) clearTimeout(this.#finalTimer);
    const timeoutMs = this.#session?.limits.finalTimeoutMs ?? 5000;
    this.#finalTimer = setTimeout(() => void this.#fail('FINAL_TIMEOUT', true), timeoutMs);
  }

  async #createSession(
    runId: number,
    signal: AbortSignal,
    timingStage: 'admission' | 'admission_refresh' = 'admission',
  ) {
    const session = await this.#dependencies.createSession(signal);
    if (runId === this.#runId) this.#recordTiming(timingStage);
    return session;
  }

  #isAdmissionExpiring(session: RealtimeAsrSessionResponse) {
    const expiresAt = Date.parse(session.expiresAt);
    const now = this.#dependencies.wallClockNow?.() ?? Date.now();
    return !Number.isFinite(expiresAt) || expiresAt - now <= ADMISSION_EXPIRY_SAFETY_MS;
  }

  #now() {
    return this.#dependencies.now?.() ?? getMonotonicNow();
  }

  async #prepareCapture(runId: number, abortController: AbortController) {
    const stream = await this.#dependencies.requestMicrophone();
    if (runId !== this.#runId) {
      stopMediaStream(stream);
      throw new Error('dictation_start_cancelled');
    }

    this.#microphoneStream = stream;
    this.#recordTiming('permission');
    this.#setSnapshot({ retryable: false, status: 'connecting' });

    let capture: RealtimeAudioCapture;
    try {
      capture = await this.#dependencies.createCapture(stream);
    } catch (error) {
      abortController.abort();
      throw error;
    }

    if (runId === this.#runId) {
      this.#microphoneStream = undefined;
      this.#capture = capture;
      this.#recordTiming('capture');
    } else {
      await capture.cancel().catch(() => undefined);
    }
    return capture;
  }

  #recordTiming(stage: RealtimeDictationTimingStage) {
    if (this.#startedAt === undefined) return;

    markPerformance(stage);
    const timing = {
      durationMs: Math.max(0, Math.round(this.#now() - this.#startedAt)),
      stage,
    } satisfies RealtimeDictationTiming;
    try {
      this.#dependencies.onTiming?.(timing);
    } catch (error) {
      void error;
    }
  }

  async #fail(code: RealtimeDictationErrorCode, retryable: boolean) {
    if (this.#terminalTransition) return;
    this.#terminalTransition = true;
    this.#finalizeEditor();
    ++this.#runId;
    await this.#releaseResources();
    this.#setError(code, retryable);
  }

  async #complete() {
    if (this.#terminalTransition) return;
    this.#terminalTransition = true;
    ++this.#runId;
    await this.#releaseResources();
    this.#setSnapshot(IDLE_SNAPSHOT);
  }

  async #releaseResources() {
    this.#acceptingAudio = false;
    this.#abortController?.abort();
    this.#abortController = undefined;
    if (this.#connectTimer) clearTimeout(this.#connectTimer);
    this.#connectTimer = undefined;
    if (this.#finalTimer) clearTimeout(this.#finalTimer);
    this.#finalTimer = undefined;
    this.#lifecycleCleanup?.();
    this.#lifecycleCleanup = undefined;
    this.#queue?.dispose();
    this.#queue = undefined;
    if (this.#microphoneStream) stopMediaStream(this.#microphoneStream);
    this.#microphoneStream = undefined;
    await this.#capture?.cancel().catch(() => undefined);
    this.#capture = undefined;
    if (this.#socket) {
      const socket = this.#socket;
      this.#closingSocket = true;
      socket.removeEventListener('open', this.#handleOpen);
      socket.removeEventListener('message', this.#handleMessage);
      socket.removeEventListener('error', this.#handleSocketError);
      socket.removeEventListener('close', this.#handleClose);
      if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) {
        socket.close(1000, 'dictation_finished');
      }
      this.#socket = undefined;
      this.#closingSocket = false;
    }
    this.#session = undefined;
    this.#startedAt = undefined;
    this.#transcript = undefined;
  }

  #setError(code: RealtimeDictationErrorCode, retryable: boolean) {
    this.#setSnapshot({ errorCode: code, retryable, status: 'error' });
  }

  #finalizeEditor() {
    if (this.#editorFinalized) return;
    this.#editorFinalized = true;
    this.#transcript?.discardPartial();
    this.#dependencies.editor.finalize(this.#transcript?.snapshot.committed ?? '');
  }

  #setSnapshot(snapshot: RealtimeDictationSnapshot) {
    this.#snapshot = snapshot;
    for (const subscriber of this.#subscribers) subscriber();
  }
}
