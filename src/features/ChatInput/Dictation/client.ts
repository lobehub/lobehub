import { type RealtimeAudioCapture, stopMediaStream } from './audio';
import { toClientError } from './clientErrors';
import type { DictationConnection, RealtimeAsrWebSocket } from './connection';
import { closeDictationSocket, closeUnadoptedSocket, connectDictationSession } from './connection';
import type {
  RealtimeAsrClientTimings,
  RealtimeAsrSessionResponse,
  RealtimeDictationErrorCode,
  RealtimeDictationSnapshot,
} from './contract';
import {
  parseRealtimeAsrServerEvent,
  REALTIME_ASR_DEFERRED_LIMITS,
  REALTIME_ASR_LIMITS,
  RealtimeDictationError,
} from './contract';
import type { DictationAnchorSnapshot, DictationEditorAdapter } from './editor';
import { BoundedWebSocketFrameQueue } from './frameQueue';
import { attachDictationLifecycle } from './lifecycle';
import { DictationPrefetcher } from './prefetch';
import type { RealtimeDictationTiming, RealtimeDictationTimingStage } from './timing';
import { clearPerformanceMarks, getMonotonicNow, markPerformance, reportTiming } from './timing';
import { DictationTranscript } from './transcript';

export type { RealtimeAsrWebSocket } from './connection';
export type { RealtimeDictationTiming, RealtimeDictationTimingStage } from './timing';
export { REALTIME_DICTATION_PERFORMANCE_MARKS } from './timing';

export type DictationCancelReason = 'audio_interruption' | 'network_change' | 'user_cancelled';

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

const SOCKET_OPEN = 1;
const LEGACY_PREROLL_FRAMES = 2;

export class RealtimeDictationClient {
  readonly #dependencies: RealtimeDictationDependencies;
  readonly #subscribers = new Set<() => void>();
  #acceptingAudio = false;
  #abortController?: AbortController;
  #activation?: Promise<void>;
  #anchor?: DictationAnchorSnapshot;
  #capture?: RealtimeAudioCapture;
  #closingSocket = false;
  #connectTimer?: ReturnType<typeof setTimeout>;
  #deferred = false;
  #editorFinalized = false;
  #finalTimer?: ReturnType<typeof setTimeout>;
  #lifecycleCleanup?: () => void;
  #microphoneStream?: MediaStream;
  #pendingFrames: ArrayBuffer[] = [];
  readonly #prefetcher: DictationPrefetcher;
  #queue?: BoundedWebSocketFrameQueue;
  #resolveActivation?: () => void;
  #runId = 0;
  #session?: RealtimeAsrSessionResponse;
  #snapshot = IDLE_SNAPSHOT;
  #socket?: RealtimeAsrWebSocket;
  #startedAt?: number;
  #terminalTransition = false;
  #timings: RealtimeAsrClientTimings = {};
  #transcript?: DictationTranscript;

  constructor(dependencies: RealtimeDictationDependencies) {
    this.#dependencies = dependencies;
    this.#prefetcher = new DictationPrefetcher({
      connect: (signal) => this.#connect(signal),
      now: () => this.#now(),
    });
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  };

  async prefetch() {
    if (this.#snapshot.status !== 'idle' && this.#snapshot.status !== 'error') return;
    await this.#prefetcher.prefetch();
  }

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
    this.#timings = {};
    const anchor = this.#dependencies.editor.begin(() => {
      void this.cancel('audio_interruption');
    });
    if (!anchor) {
      this.#setError('AUDIO_CAPTURE_FAILED', true);
      return;
    }
    this.#anchor = anchor;

    this.#setSnapshot({ retryable: false, status: 'requesting_permission' });
    const abortController = new AbortController();
    this.#abortController = abortController;
    this.#activation = new Promise((resolve) => {
      this.#resolveActivation = resolve;
    });
    const connection = this.#takeConnection(runId, abortController.signal);
    connection.catch(() => undefined);
    const microphone = this.#requestMicrophone(runId);
    microphone.catch(() => undefined);
    const preparing = microphone.then((stream) =>
      this.#createCapture(runId, stream, abortController),
    );
    preparing.catch(() => undefined);
    // session.start goes out once the microphone is granted so the Provider
    // handshake overlaps capture setup.
    const activation = Promise.all([connection, microphone]).then(([connected]) => {
      if (runId === this.#runId) this.#activate(connected);
      else closeDictationSocket(connected.socket);
    });
    activation.catch(() => closeUnadoptedSocket(connection, (socket) => socket === this.#socket));

    try {
      const capture = await Promise.race([
        preparing,
        connection.then(() => new Promise<never>(() => undefined)),
      ]);
      if (runId !== this.#runId) {
        await capture.cancel().catch(() => undefined);
        return;
      }

      this.#acceptingAudio = true;
      await capture.start(this.#handleAudioFrame, () => {
        void this.#fail('AUDIO_CAPTURE_FAILED', true);
      });
      if (runId !== this.#runId) return;
      this.#timings.pressToMicMs = this.#elapsedSincePress();
      this.#setSnapshot({ retryable: false, status: 'listening' });
      this.#lifecycleCleanup = attachDictationLifecycle({
        onInterrupted: () => void this.cancel('audio_interruption'),
        onOffline: () => void this.#fail('NETWORK_DISCONNECTED', true),
      });

      await activation;
    } catch (error) {
      if (runId !== this.#runId) return;
      const clientError = toClientError(error);
      await this.#fail(clientError.code, clientError.retryable);
    }
  }

  async stop() {
    if (this.#snapshot.status !== 'listening') return;

    this.#setSnapshot({ retryable: false, status: 'finalizing' });
    try {
      await this.#capture?.stop();
      this.#acceptingAudio = false;
      await this.#waitForActivation();
      if (!this.#socket || !this.#queue) {
        throw new RealtimeDictationError('NETWORK_DISCONNECTED', true);
      }
      await this.#queue.waitForEmpty(
        this.#deferred ? this.#session!.limits.providerConnectTimeoutMs : 1000,
      );
      if (this.#socket.readyState !== SOCKET_OPEN) {
        throw new RealtimeDictationError('NETWORK_DISCONNECTED', true);
      }
      this.#socket.send(
        JSON.stringify({
          ...(this.#deferred ? { clientTimings: this.#timings } : {}),
          type: 'session.end',
        }),
      );
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
    if (
      (statusBeforeCancel !== 'listening' && statusBeforeCancel !== 'finalizing') ||
      this.#socket?.readyState !== SOCKET_OPEN
    ) {
      await this.#complete();
      return;
    }

    this.#setSnapshot({ retryable: false, status: 'finalizing' });
    await this.#capture?.cancel().catch(() => undefined);
    this.#queue?.dispose();
    this.#socket.send(JSON.stringify({ reason, type: 'session.cancel' }));
    this.#startFinalTimer();
  }

  async dispose() {
    ++this.#runId;
    this.#prefetcher.discard();
    this.#finalizeEditor();
    await this.#releaseResources();
    this.#setSnapshot(IDLE_SNAPSHOT);
  }

  async #takeConnection(runId: number, signal: AbortSignal): Promise<DictationConnection> {
    const prefetched = await this.#prefetcher.take();
    if (prefetched) return prefetched;
    const connected = await this.#connect(signal, (stage) => {
      if (runId === this.#runId) this.#recordTiming(stage);
    });
    this.#prefetcher.resetBackoff();
    return connected;
  }

  #connect(
    signal: AbortSignal,
    onAdmission?: (stage: 'admission' | 'admission_refresh') => void,
  ): Promise<DictationConnection> {
    return connectDictationSession({
      createSession: this.#dependencies.createSession,
      createWebSocket: this.#dependencies.createWebSocket,
      onAdmission,
      signal,
      wallClockNow: this.#dependencies.wallClockNow,
    });
  }

  #activate({ deferred, session, socket }: DictationConnection) {
    this.#session = session;
    this.#deferred = deferred;
    this.#transcript = new DictationTranscript({ ...this.#anchor!, sessionId: session.sessionId });
    this.#socket = socket;
    if (socket.readyState !== SOCKET_OPEN) {
      void this.#fail('NETWORK_DISCONNECTED', true);
      return;
    }
    socket.addEventListener('message', this.#handleMessage);
    socket.addEventListener('error', this.#handleSocketError);
    socket.addEventListener('close', this.#handleClose);

    if (deferred) {
      socket.send(JSON.stringify({ type: 'session.start' }));
      this.#timings.pressToStartSentMs = this.#elapsedSincePress();
      this.#connectTimer = setTimeout(
        () => void this.#fail('PROVIDER_TIMEOUT', true),
        session.limits.providerConnectTimeoutMs + session.limits.authTimeoutMs,
      );
    }
    this.#queue = new BoundedWebSocketFrameQueue(socket, {
      maxFrames: deferred
        ? REALTIME_ASR_DEFERRED_LIMITS.maxPrerollFrames
        : session.limits.maxBufferedFrames,
    });
    // A legacy Gateway paces from its first frame and rejects a burst that
    // fills its queue before live frames follow.
    const pending = deferred
      ? this.#pendingFrames
      : this.#pendingFrames.slice(-LEGACY_PREROLL_FRAMES);
    this.#pendingFrames = [];
    this.#recordTiming('ws_ready');
    this.#resolveActivation?.();
    for (const frame of pending) {
      if (!this.#queue.enqueue(frame)) {
        void this.#fail('BACKPRESSURE', true);
        return;
      }
    }
  }

  async #waitForActivation() {
    if (this.#queue) return;
    const limits = this.#session?.limits ?? REALTIME_ASR_LIMITS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#activation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new RealtimeDictationError('PROVIDER_TIMEOUT', true)),
            limits.authTimeoutMs + limits.providerConnectTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

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
        if (this.#connectTimer) clearTimeout(this.#connectTimer);
        this.#connectTimer = undefined;
        break;
      }
      case 'transcript.partial':
      case 'transcript.final': {
        this.#timings.pressToFirstPartialMs ??= this.#elapsedSincePress();
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
    if (this.#queue) {
      if (!this.#queue.enqueue(frame)) void this.#fail('BACKPRESSURE', true);
      return;
    }
    this.#pendingFrames.push(frame);
    if (this.#pendingFrames.length > REALTIME_ASR_DEFERRED_LIMITS.maxPrerollFrames) {
      void this.#fail('PROVIDER_TIMEOUT', true);
    }
  };

  #handleSocketError = () => {
    if (!this.#closingSocket) void this.#fail('NETWORK_DISCONNECTED', true);
  };

  #handleClose = () => {
    if (!this.#closingSocket && this.#snapshot.status !== 'idle') {
      void this.#fail('NETWORK_DISCONNECTED', true);
    }
  };

  #startFinalTimer() {
    if (this.#finalTimer) clearTimeout(this.#finalTimer);
    const limits = this.#session?.limits;
    const providerPendingMs = limits && this.#connectTimer ? limits.providerConnectTimeoutMs : 0;
    const timeoutMs = (limits?.finalTimeoutMs ?? 5000) + providerPendingMs;
    this.#finalTimer = setTimeout(() => void this.#fail('FINAL_TIMEOUT', true), timeoutMs);
  }

  #now() {
    return this.#dependencies.now?.() ?? getMonotonicNow();
  }

  #elapsedSincePress() {
    const elapsed = Math.round(this.#now() - (this.#startedAt ?? this.#now()));
    return Math.min(REALTIME_ASR_LIMITS.maxSessionMs, Math.max(0, elapsed));
  }

  async #requestMicrophone(runId: number) {
    const stream = await this.#dependencies.requestMicrophone();
    if (runId !== this.#runId) {
      stopMediaStream(stream);
      throw new Error('dictation_start_cancelled');
    }

    this.#microphoneStream = stream;
    this.#recordTiming('permission');
    return stream;
  }

  async #createCapture(runId: number, stream: MediaStream, abortController: AbortController) {
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
    reportTiming(stage, this.#now() - this.#startedAt, this.#dependencies.onTiming);
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
    this.#activation = undefined;
    this.#resolveActivation = undefined;
    this.#pendingFrames = [];
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
      socket.removeEventListener('message', this.#handleMessage);
      socket.removeEventListener('error', this.#handleSocketError);
      socket.removeEventListener('close', this.#handleClose);
      closeDictationSocket(socket);
      this.#socket = undefined;
      this.#closingSocket = false;
    }
    this.#anchor = undefined;
    this.#deferred = false;
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
