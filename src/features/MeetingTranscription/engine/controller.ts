import type { MeetingErrorCode, MeetingLanguage, MeetingPlatform } from '@lobechat/types';

import type { RealtimeAudioCapture } from '@/features/ChatInput/Dictation/audio';
import type { RealtimeAsrWebSocket } from '@/features/ChatInput/Dictation/client';
import type { RealtimeAsrSessionResponse } from '@/features/ChatInput/Dictation/contract';

import { FrameLedger } from './frameLedger';
import { GatewayTranscriber } from './gatewayTranscriber';
import { SegmentSink } from './segmentSink';
import type { LiveSegment, LiveTranscriber, LiveTranscriberStatus } from './types';
import type { WindowRequest } from './windowTranscriber';
import { WindowTranscriber } from './windowTranscriber';

export type RecorderPhase =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'paused'
  /** Stopped; the live draft is catching up and the meeting is being closed. */
  | 'finishing'
  | 'uploading'
  /** The full recording is being transcribed with speakers. */
  | 'refining'
  /** Post-processing ended; see `refine` for its outcome. */
  | 'done';

/** Failures of the recorder itself, each with its own recovery action. */
export type RecorderErrorCode =
  /** Retry `start` once the browser grants the microphone. */
  | 'microphone_permission_denied'
  | 'microphone_not_supported'
  /** The microphone went away mid-meeting; recording paused, `resume` continues. */
  | 'capture_interrupted'
  /** Could not create the meeting; retry `start`. */
  | 'start_failed'
  /** Recording is safe in memory; `retryProcessing` uploads it again. */
  | 'upload_failed';

export type LiveMode = 'gateway' | 'window';

export interface RecorderSnapshot {
  durationMs: number;
  error?: RecorderErrorCode;
  level: number;
  live: LiveTranscriberStatus & { mode: LiveMode };
  meetingId?: string;
  phase: RecorderPhase;
  refine?: { errorCode?: MeetingErrorCode; status: 'failed' | 'ready' | 'running' };
  /** Committed live draft, in order. */
  segments: LiveSegment[];
  /** Text still being recognized after the last committed segment. */
  tail: string;
}

export interface RefinedMeeting {
  error?: { code: MeetingErrorCode } | null;
  status: string;
}

export interface MeetingRecorderDependencies {
  api: {
    appendRealtimeSegments: (meetingId: string, segments: LiveSegment[]) => Promise<unknown>;
    attachAudio: (meetingId: string, fileId: string) => Promise<unknown>;
    create: (params: {
      language?: MeetingLanguage;
      platform: MeetingPlatform;
      realtimeProvider: 'cloud';
      refineProvider: 'cloud';
      title: string;
    }) => Promise<{ id: string } | undefined>;
    finish: (meetingId: string, durationMs: number) => Promise<unknown>;
    pause: (meetingId: string) => Promise<unknown>;
    refine: (meetingId: string) => Promise<RefinedMeeting | undefined>;
    resume: (meetingId: string) => Promise<unknown>;
    transcribeWindow: (meetingId: string, request: WindowRequest) => Promise<{ text: string }>;
  };
  createCapture: (stream: MediaStream) => Promise<RealtimeAudioCapture>;
  createGatewaySession: (signal: AbortSignal) => Promise<RealtimeAsrSessionResponse>;
  createWebSocket: (url: string) => RealtimeAsrWebSocket;
  onOnline?: (listener: () => void) => () => void;
  platform: MeetingPlatform;
  requestMicrophone: () => Promise<MediaStream>;
  /** Upload the finished recording; resolves with its file id. */
  uploadRecording: (file: File, meetingId: string) => Promise<string>;
}

const DRAIN_TIMEOUT_MS = 20_000;
const SINK_FLUSH_TIMEOUT_MS = 10_000;

const INITIAL_SNAPSHOT: RecorderSnapshot = {
  durationMs: 0,
  level: 0,
  live: { mode: 'gateway', pendingMs: 0, state: 'live' },
  phase: 'idle',
  segments: [],
  tail: '',
};

const toMicrophoneError = (error: unknown): RecorderErrorCode => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'microphone_permission_denied';
  }
  if (
    error instanceof Error &&
    (error.message === 'microphone_not_supported' ||
      error.message === 'audio_worklet_not_supported')
  ) {
    return 'microphone_not_supported';
  }
  return 'microphone_permission_denied';
};

/**
 * One meeting recording, from microphone to refined transcript.
 *
 * Lives outside React so navigating between pages never interrupts it. Audio
 * frames go to a `FrameLedger` (the recording), and from there to the live
 * transcriber: the realtime gateway, or — where none is deployed — windowed
 * transcription through the server. After stop, the ledger is uploaded as
 * WAV and the server refines it with speakers and timestamps.
 */
export class MeetingRecorder {
  readonly #deps: MeetingRecorderDependencies;
  readonly #listeners = new Set<() => void>();
  #capture?: RealtimeAudioCapture;
  #finished = false;
  #audioFileId?: string;
  #ledger = new FrameLedger();
  #live?: LiveTranscriber;
  #sink?: SegmentSink;
  #snapshot = INITIAL_SNAPSHOT;
  #title = '';
  /** Remember a missing gateway for the session so later meetings skip the failed admission. */
  static gatewayUnavailable = false;

  constructor(deps: MeetingRecorderDependencies) {
    this.#deps = deps;
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The recording so far as WAV, e.g. for a local download. */
  getRecording = () => this.#ledger.toWav();

  // ── Lifecycle ──

  start = async (options: { language?: MeetingLanguage; title: string }) => {
    const { phase } = this.#snapshot;
    if (phase !== 'idle' && phase !== 'done') return;

    this.#reset();
    this.#title = options.title;
    this.#set({ phase: 'requesting_permission' });

    let stream: MediaStream;
    try {
      stream = await this.#deps.requestMicrophone();
    } catch (error) {
      this.#set({ error: toMicrophoneError(error), phase: 'idle' });
      return;
    }

    let meetingId: string | undefined;
    try {
      meetingId = (
        await this.#deps.api.create({
          language: options.language,
          platform: this.#deps.platform,
          realtimeProvider: 'cloud',
          refineProvider: 'cloud',
          title: options.title,
        })
      )?.id;
    } catch {
      meetingId = undefined;
    }
    if (!meetingId) {
      for (const track of stream.getTracks()) track.stop();
      this.#set({ error: 'start_failed', phase: 'idle' });
      return;
    }

    this.#set({ meetingId });
    this.#sink = new SegmentSink({
      save: async (segments) => {
        await this.#deps.api.appendRealtimeSegments(meetingId, segments);
      },
    });
    this.#live = MeetingRecorder.gatewayUnavailable
      ? this.#createWindowTranscriber()
      : this.#createGatewayTranscriber();
    this.#live.start();

    if (await this.#startCapture(stream)) {
      this.#set({ phase: 'recording' });
      this.#toggleUnloadGuard(true);
    }
  };

  pause = async () => {
    if (this.#snapshot.phase !== 'recording') return;
    await this.#stopCapture();
    this.#live?.pause();
    this.#set({ phase: 'paused' });
    await this.#deps.api.pause(this.#snapshot.meetingId!).catch(() => undefined);
  };

  resume = async () => {
    if (this.#snapshot.phase !== 'paused') return;

    let stream: MediaStream;
    try {
      stream = await this.#deps.requestMicrophone();
    } catch (error) {
      this.#set({ error: toMicrophoneError(error) });
      return;
    }
    if (await this.#startCapture(stream)) {
      this.#set({ error: undefined, phase: 'recording' });
      await this.#deps.api.resume(this.#snapshot.meetingId!).catch(() => undefined);
    }
  };

  stop = async () => {
    const { phase } = this.#snapshot;
    if (phase !== 'recording' && phase !== 'paused') return;

    this.#set({ error: undefined, phase: 'finishing' });
    await this.#stopCapture();
    // Let the live draft catch up; the refined transcript is authoritative either way.
    await this.#live?.drain(DRAIN_TIMEOUT_MS);
    await this.#sink?.flush(SINK_FLUSH_TIMEOUT_MS);
    await this.#process();
  };

  /** Continue post-processing after an upload or refine failure. */
  retryProcessing = async () => {
    const { phase, refine } = this.#snapshot;
    if (phase === 'done' && refine?.status === 'failed') {
      this.#set({ phase: 'refining', refine: { status: 'running' } });
      await this.#refine();
      return;
    }
    if (this.#snapshot.error === 'upload_failed') await this.#process();
  };

  /** Retry live transcription now; everything recorded meanwhile is caught up. */
  retryLive = () => this.#live?.retry();

  /** Close the finished meeting and return to idle. */
  reset = () => {
    const { phase } = this.#snapshot;
    if (phase === 'recording' || phase === 'paused' || phase === 'finishing') return;
    this.#reset();
  };

  // ── Internals ──

  async #process() {
    const meetingId = this.#snapshot.meetingId!;
    try {
      if (!this.#finished) {
        await this.#deps.api.finish(meetingId, this.#ledger.durationMs);
        this.#finished = true;
      }
      if (!this.#audioFileId) {
        this.#set({ error: undefined, phase: 'uploading' });
        const file = new File([this.#ledger.toWav()], `${this.#title || 'meeting'}.wav`, {
          type: 'audio/wav',
        });
        const fileId = await this.#deps.uploadRecording(file, meetingId);
        await this.#deps.api.attachAudio(meetingId, fileId);
        this.#audioFileId = fileId;
      }
    } catch {
      this.#set({ error: 'upload_failed', phase: 'finishing' });
      return;
    }

    this.#toggleUnloadGuard(false);
    this.#set({ phase: 'refining', refine: { status: 'running' } });
    await this.#refine();
  }

  async #refine() {
    const meetingId = this.#snapshot.meetingId!;
    try {
      const meeting = await this.#deps.api.refine(meetingId);
      const ready = meeting?.status === 'ready';
      this.#set({
        phase: 'done',
        refine: ready
          ? { status: 'ready' }
          : { errorCode: meeting?.error?.code ?? 'transcription_failed', status: 'failed' },
      });
    } catch {
      this.#set({
        phase: 'done',
        refine: { errorCode: 'provider_unavailable', status: 'failed' },
      });
    }
  }

  async #startCapture(stream: MediaStream) {
    try {
      const capture = await this.#deps.createCapture(stream);
      this.#capture = capture;
      await capture.start(this.#handleFrame, () => void this.#handleCaptureLost());
      return true;
    } catch (error) {
      await this.#capture?.cancel().catch(() => undefined);
      this.#capture = undefined;
      // The meeting exists already: stay paused so `resume` can retry the microphone.
      this.#set({ error: toMicrophoneError(error), phase: 'paused' });
      return false;
    }
  }

  async #stopCapture() {
    const capture = this.#capture;
    this.#capture = undefined;
    await capture?.stop().catch(() => undefined);
  }

  async #handleCaptureLost() {
    if (this.#snapshot.phase !== 'recording') return;
    await this.pause();
    this.#set({ error: 'capture_interrupted' });
  }

  #handleFrame = (frame: ArrayBuffer) => {
    const { phase } = this.#snapshot;
    // `stop()` flushes the worklet's last partial frame while finishing.
    if (phase !== 'recording' && phase !== 'finishing' && phase !== 'paused') return;
    this.#ledger.append(frame);
    this.#live?.notifyFrame();
    this.#set({ durationMs: this.#ledger.durationMs, level: this.#ledger.level() });
  };

  #liveEvents(mode: LiveMode) {
    return {
      ledger: this.#ledger,
      onOnline: this.#deps.onOnline,
      onSegments: (segments: LiveSegment[]) => {
        if (mode === 'gateway') this.#sink?.push(segments);
        this.#set({ segments: [...this.#snapshot.segments, ...segments] });
      },
      onStatus: (status: LiveTranscriberStatus) => {
        if (
          mode === 'gateway' &&
          status.state === 'blocked' &&
          status.errorCode === 'provider_not_configured'
        ) {
          this.#fallBackToWindows();
          return;
        }
        this.#set({ live: { ...status, mode } });
      },
      onTail: (tail: string) => this.#set({ tail }),
    };
  }

  #createGatewayTranscriber(options?: { startFrame: number; startSeq: number }) {
    return new GatewayTranscriber(
      {
        ...this.#liveEvents('gateway'),
        createSession: this.#deps.createGatewaySession,
        createWebSocket: this.#deps.createWebSocket,
      },
      options,
    );
  }

  #createWindowTranscriber(options?: { startFrame: number; startSeq: number }) {
    const meetingId = this.#snapshot.meetingId!;
    return new WindowTranscriber(
      {
        ...this.#liveEvents('window'),
        transcribe: (request) => this.#deps.api.transcribeWindow(meetingId, request),
      },
      options,
    );
  }

  /** No realtime gateway here: continue the same draft through windowed transcription. */
  #fallBackToWindows() {
    const gateway = this.#live;
    if (!(gateway instanceof GatewayTranscriber)) return;
    MeetingRecorder.gatewayUnavailable = true;

    const resumePoint = gateway.resumePoint;
    gateway.dispose();
    this.#live = this.#createWindowTranscriber(resumePoint);
    this.#live.start();
    this.#set({ live: { mode: 'window', pendingMs: 0, state: 'live' }, tail: '' });
    // Frames recorded while the gateway was being tried are cut into windows now.
    this.#live.notifyFrame();
    if (this.#snapshot.phase === 'paused' || this.#snapshot.phase === 'finishing') {
      this.#live.pause();
    }
  }

  #unloadGuard = (event: BeforeUnloadEvent) => {
    event.preventDefault();
  };

  #toggleUnloadGuard(on: boolean) {
    if (typeof window === 'undefined') return;
    if (on) window.addEventListener('beforeunload', this.#unloadGuard);
    else window.removeEventListener('beforeunload', this.#unloadGuard);
  }

  #reset() {
    this.#live?.dispose();
    this.#sink?.dispose();
    this.#live = undefined;
    this.#sink = undefined;
    this.#ledger = new FrameLedger();
    this.#finished = false;
    this.#audioFileId = undefined;
    this.#toggleUnloadGuard(false);
    this.#snapshot = INITIAL_SNAPSHOT;
    this.#emit();
  }

  #set(patch: Partial<RecorderSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    this.#emit();
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}
