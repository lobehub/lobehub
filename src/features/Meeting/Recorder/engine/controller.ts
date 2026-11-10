import type {
  MeetingPlatform,
  MeetingRealtimeProvider,
  MeetingRefineProvider,
} from '@lobechat/types';

import type {
  LiveSegment,
  MeetingRecorderState,
  MicrophoneDevice,
  MicrophonePermission,
  RecorderErrorCode,
} from '@/store/meeting';

import { LevelMeter } from './levelMeter';
import { LiveTranscriber, type NetworkStatus } from './liveTranscriber';
import { frameLevel, type LiveWindow, LiveWindowCutter } from './liveWindows';

/** PCM capture of the microphone stream: 200 ms frames of 16 kHz mono PCM16. */
export interface FrameCapture {
  cancel: () => Promise<void>;
  start: (onFrame: (frame: ArrayBuffer) => void, onError: () => void) => Promise<void>;
  stop: () => Promise<void>;
}

/** The slice of `MediaRecorder` the controller drives, so tests can fake it. */
export interface AudioRecorder {
  pause: () => void;
  resume: () => void;
  start: () => void;
  /** Stop and resolve with the whole recording. */
  stop: () => Promise<Blob>;
}

/** One refined, diarized segment produced on this device. */
export interface LocalRefinedSegment {
  endMs: number;
  speakerLabel?: string;
  startMs: number;
  text: string;
}

/**
 * Desktop on-device transcription for one recording. The engine records the
 * audio to a file on this device, drafts the live transcript from the frames,
 * and refines the file with speakers afterwards — the audio is never uploaded.
 */
export interface LocalTranscriptionSession {
  cancel: () => Promise<void>;
  pause: () => void;
  pushFrame: (frame: ArrayBuffer) => void;
  refine: (audioPath: string) => Promise<LocalRefinedSegment[]>;
  resume: () => void;
  start: (handlers: {
    onError: () => void;
    onFinal: (segment: { endMs?: number; startMs?: number; text: string }) => void;
  }) => Promise<void>;
  /** Resolve with the path of the recording on this device. */
  stop: () => Promise<{ audioPath?: string }>;
}

export interface MeetingRecorderDeps {
  api: {
    appendRealtimeSegments: (meetingId: string, segments: LiveSegment[]) => Promise<unknown>;
    attachAudio: (meetingId: string, fileId: string) => Promise<unknown>;
    attachLocalAudio?: (meetingId: string, localAudioPath: string) => Promise<unknown>;
    completeLocalRefine?: (meetingId: string, segments: LocalRefinedSegment[]) => Promise<unknown>;
    create: (params: {
      platform: MeetingPlatform;
      realtimeProvider: MeetingRealtimeProvider;
      refineProvider: MeetingRefineProvider;
      title: string;
    }) => Promise<{ id: string } | undefined>;
    failLocalRefine?: (
      meetingId: string,
      code: 'audio_missing' | 'transcription_failed',
      message?: string,
    ) => Promise<unknown>;
    finish: (meetingId: string, durationMs: number) => Promise<unknown>;
    pause: (meetingId: string) => Promise<unknown>;
    /** Post-recording pass: full transcript with speakers, then the minutes. */
    refine: (meetingId: string) => Promise<unknown>;
    resume: (meetingId: string) => Promise<unknown>;
    startLocalRefine?: (meetingId: string) => Promise<unknown>;
  };
  createAudioRecorder: (stream: MediaStream) => AudioRecorder;
  createCapture: (stream: MediaStream) => Promise<FrameCapture>;
  /**
   * The on-device session when the user chose local transcription and this
   * device can run it, otherwise `undefined` (the cloud path is used).
   */
  createLocalSession?: () => Promise<LocalTranscriptionSession | undefined>;
  frameMs: number;
  getUserMedia: (deviceId?: string) => Promise<MediaStream>;
  /** Live transcription for one window, or `undefined` when no model is configured. */
  liveTranscribe: () => ((window: LiveWindow) => Promise<string>) | undefined;
  /** Connectivity; live windows wait for the connection instead of being dropped. */
  network?: NetworkStatus;
  platform: MeetingPlatform;
  /** Fire-and-forget refresh of the meetings list after a meeting changes. */
  refreshMeetings: () => void;
  store: {
    getRecorder: () => MeetingRecorderState;
    getSelectedDeviceId: () => string | undefined;
    patchRecorder: (patch: Partial<MeetingRecorderState>, action?: string) => void;
    setDevices: (devices: MicrophoneDevice[]) => void;
    setPermission: (permission: MicrophonePermission) => void;
  };
  uploadRecording: (file: File) => Promise<string>;
}

/** How long a stop waits for the live transcript to catch up before saving. */
const DRAIN_TIMEOUT_MS = 20_000;

export const mapMicrophoneError = (error: unknown): RecorderErrorCode => {
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device';
  if ((error as Error | undefined)?.message === 'microphone_not_supported') return 'not_supported';
  return 'not_supported';
};

const recordingExtension = (mimeType: string) =>
  mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';

/**
 * The app-wide meeting recorder. One instance lives for the whole SPA, so a
 * recording keeps going while the user moves between pages; components only
 * read the store and call these methods.
 */
export class MeetingRecorderController {
  readonly levels = new LevelMeter();
  readonly #deps: MeetingRecorderDeps;
  #audio?: AudioRecorder;
  #capture?: FrameCapture;
  #cutter?: LiveWindowCutter;
  #local?: LocalTranscriptionSession;
  #localMeetingId?: string;
  /** Recording kept after a failed upload, so `retryUpload` can send it again. */
  #pendingUpload?: File;
  /** Duration of a stop whose `finish` did not reach the server, sent again before the upload. */
  #pendingFinishMs?: number;
  #segments: LiveSegment[] = [];
  #transcriber?: LiveTranscriber;

  constructor(deps: MeetingRecorderDeps) {
    this.#deps = deps;
  }

  get #recorder() {
    return this.#deps.store.getRecorder();
  }

  #patch(patch: Partial<MeetingRecorderState>, action: string) {
    this.#deps.store.patchRecorder(patch, action);
  }

  /** List microphones; labels only appear once the user has granted access. */
  async refreshDevices(enumerate: () => Promise<MediaDeviceInfo[]>) {
    try {
      const devices = await enumerate();
      this.#deps.store.setDevices(
        devices
          .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          })),
      );
    } catch (error) {
      console.warn('[meeting:recorder] cannot list microphones', error);
    }
  }

  async start({ title }: { title: string }) {
    const { phase } = this.#recorder;
    if (phase !== 'idle' && phase !== 'done') return;

    this.levels.reset();
    this.#segments = [];
    this.#pendingUpload = undefined;
    this.#pendingFinishMs = undefined;
    this.#patch(
      {
        durationMs: 0,
        error: undefined,
        live: 'live',
        meetingId: undefined,
        pendingWindows: 0,
        phase: 'requesting_permission',
        segments: [],
        title,
      },
      'start/requestPermission',
    );

    let stream: MediaStream;
    try {
      stream = await this.#deps.getUserMedia(this.#deps.store.getSelectedDeviceId());
    } catch (error) {
      const code = mapMicrophoneError(error);
      if (code === 'permission_denied') this.#deps.store.setPermission('denied');
      this.#patch({ error: code, phase: 'idle' }, 'start/microphoneFailed');
      return;
    }
    this.#deps.store.setPermission('granted');

    let capture: FrameCapture;
    try {
      capture = await this.#deps.createCapture(stream);
    } catch (error) {
      console.error('[meeting:recorder] audio capture unavailable', error);
      for (const track of stream.getTracks()) track.stop();
      this.#patch({ error: 'not_supported', phase: 'idle' }, 'start/captureFailed');
      return;
    }

    const local = await this.#startLocalSession();
    const transcribe = local ? undefined : this.#deps.liveTranscribe();
    let meetingId: string | undefined;
    try {
      const meeting = await this.#deps.api.create({
        platform: this.#deps.platform,
        realtimeProvider: local ? 'local' : transcribe ? 'cloud' : 'none',
        refineProvider: local ? 'local' : 'cloud',
        title,
      });
      meetingId = meeting?.id;
    } catch (error) {
      console.error('[meeting:recorder] cannot create meeting', error);
    }
    if (!meetingId) {
      await local?.cancel().catch(() => undefined);
      await capture.cancel();
      this.#patch({ error: 'start_failed', phase: 'idle' }, 'start/createFailed');
      return;
    }

    this.#capture = capture;
    this.#cutter = new LiveWindowCutter({ frameMs: this.#deps.frameMs });
    this.#transcriber = transcribe ? this.#createTranscriber(meetingId, transcribe) : undefined;
    this.#local = local;
    this.#localMeetingId = meetingId;
    // The local engine records the audio itself, to a file on this device.
    if (!local) {
      this.#audio = this.#deps.createAudioRecorder(stream);
      this.#audio.start();
    }

    this.#patch(
      { live: local || transcribe ? 'live' : 'unavailable', meetingId, phase: 'recording' },
      'start/recording',
    );
    this.#deps.refreshMeetings();

    await capture.start(
      (frame) => this.#onFrame(frame),
      () => void this.pause(),
    );
  }

  async pause() {
    const { meetingId, phase } = this.#recorder;
    if (phase !== 'recording' || !meetingId) return;

    this.#audio?.pause();
    this.#local?.pause();
    this.#transcriber?.enqueue(this.#cutter?.flush());
    this.levels.reset();
    this.#patch({ phase: 'paused' }, 'pause');
    await this.#deps.api.pause(meetingId).catch((error) => {
      console.warn('[meeting:recorder] pause not saved', error);
    });
  }

  async resume() {
    const { meetingId, phase } = this.#recorder;
    if (phase !== 'paused' || !meetingId) return;

    this.#audio?.resume();
    this.#local?.resume();
    this.#patch({ phase: 'recording' }, 'resume');
    await this.#deps.api.resume(meetingId).catch((error) => {
      console.warn('[meeting:recorder] resume not saved', error);
    });
  }

  async stop() {
    const { durationMs, meetingId, phase, title } = this.#recorder;
    if ((phase !== 'recording' && phase !== 'paused') || !meetingId) return;

    this.#patch({ phase: 'finishing' }, 'stop/finishing');
    this.levels.reset();

    if (this.#local) return this.#stopLocal(meetingId, durationMs);

    // Stop the recorder before the capture: closing the capture ends the
    // stream's tracks, which would end the recording without its last chunk.
    const blob = await this.#audio?.stop().catch((error) => {
      console.error('[meeting:recorder] recording could not be finalized', error);
      return undefined;
    });
    await this.#capture?.stop().catch(() => undefined);
    this.#transcriber?.enqueue(this.#cutter?.flush());
    await this.#transcriber?.drain(DRAIN_TIMEOUT_MS);
    this.#transcriber?.dispose();
    this.#capture = undefined;
    this.#audio = undefined;
    this.#cutter = undefined;
    this.#transcriber = undefined;

    // Offline at stop: keep the duration and finish again with the upload retry,
    // otherwise the meeting would stay `recording` and could never be refined.
    this.#pendingFinishMs = durationMs;
    await this.#saveFinish(meetingId).catch((error) => {
      console.error('[meeting:recorder] finish not saved', error);
    });

    if (blob && blob.size > 0) {
      const extension = recordingExtension(blob.type);
      this.#pendingUpload = new File([blob], `${title || meetingId}.${extension}`, {
        type: blob.type || 'audio/webm',
      });
      await this.#upload(meetingId);
    } else {
      this.#patch({ phase: 'done' }, 'stop/noAudio');
    }

    this.#deps.refreshMeetings();
  }

  /** Send the kept recording again after `upload_failed` / `upload_offline`. */
  async retryUpload() {
    const { error, meetingId } = this.#recorder;
    const uploadError = error === 'upload_failed' || error === 'upload_offline';
    if (!uploadError || !meetingId || !this.#pendingUpload) return;

    this.#patch({ error: undefined, phase: 'finishing' }, 'retryUpload');
    await this.#upload(meetingId);
    this.#deps.refreshMeetings();
  }

  async #upload(meetingId: string) {
    const file = this.#pendingUpload;
    if (!file) return;

    try {
      await this.#saveFinish(meetingId);
      const fileId = await this.#deps.uploadRecording(file);
      await this.#deps.api.attachAudio(meetingId, fileId);
      this.#pendingUpload = undefined;
      this.#patch({ error: undefined, phase: 'done' }, 'stop/uploaded');
      // Runs on the server for minutes; the meeting page follows its status, so nothing waits here.
      void this.#deps.api
        .refine(meetingId)
        .catch((error) => console.error('[meeting:recorder] refine not started', error))
        .finally(() => this.#deps.refreshMeetings());
    } catch (error) {
      console.error('[meeting:recorder] audio upload failed', error);
      const offline = this.#deps.network?.isNetworkError(error);
      this.#patch(
        { error: offline ? 'upload_offline' : 'upload_failed', phase: 'done' },
        'stop/uploadFailed',
      );
    }
  }

  /** Open the on-device session; any failure falls back to the cloud path. */
  async #startLocalSession() {
    let session: LocalTranscriptionSession | undefined;
    try {
      session = await this.#deps.createLocalSession?.();
      if (!session) return undefined;
      await session.start({
        onError: () => this.#patch({ live: 'lagging' }, 'local/error'),
        onFinal: (segment) => this.#onLocalSegment(segment),
      });
      return session;
    } catch (error) {
      console.warn('[meeting:recorder] local transcription unavailable, using the cloud', error);
      await session?.cancel().catch(() => undefined);
      return undefined;
    }
  }

  #onLocalSegment({ endMs, startMs, text }: { endMs?: number; startMs?: number; text: string }) {
    const meetingId = this.#localMeetingId;
    const trimmed = text.trim();
    if (!meetingId || !trimmed) return;

    const end = endMs ?? this.#recorder.durationMs;
    const segment: LiveSegment = {
      endMs: end,
      seq: this.#segments.length,
      startMs: Math.min(startMs ?? end, end),
      text: trimmed,
    };
    this.#segments = [...this.#segments, segment];
    this.#patch({ live: 'live', segments: this.#segments }, 'local/segment');
    void this.#deps.api.appendRealtimeSegments(meetingId, [segment]).catch((error) => {
      console.warn('[meeting:recorder] live segment not saved', error);
    });
  }

  async #stopLocal(meetingId: string, durationMs: number) {
    const local = this.#local!;
    const { audioPath } = await local.stop().catch((error) => {
      console.error('[meeting:recorder] local recording could not be finalized', error);
      return { audioPath: undefined };
    });
    await this.#capture?.stop().catch(() => undefined);
    this.#capture = undefined;
    this.#local = undefined;
    this.#localMeetingId = undefined;

    // Store where the recording lives first, so finishing moves straight on to `transcribing`.
    if (audioPath) {
      await this.#deps.api.attachLocalAudio?.(meetingId, audioPath).catch((error) => {
        console.error('[meeting:recorder] local audio path not saved', error);
      });
    }
    await this.#deps.api.finish(meetingId, durationMs).catch((error) => {
      console.error('[meeting:recorder] finish not saved', error);
    });
    this.#patch({ phase: 'done' }, audioPath ? 'stop/localSaved' : 'stop/noAudio');
    this.#deps.refreshMeetings();

    if (audioPath) void this.#refineLocally(local, meetingId, audioPath);
  }

  /** Refine on this device; the meeting page follows the status, so nothing waits here. */
  async #refineLocally(local: LocalTranscriptionSession, meetingId: string, audioPath: string) {
    const { api } = this.#deps;
    try {
      await api.startLocalRefine?.(meetingId);
      this.#deps.refreshMeetings();
      const segments = await local.refine(audioPath);
      await api.completeLocalRefine?.(meetingId, segments);
    } catch (error) {
      console.error('[meeting:recorder] local refine failed', error);
      await api
        .failLocalRefine?.(meetingId, 'transcription_failed', (error as Error)?.message)
        .catch(() => undefined);
    } finally {
      this.#deps.refreshMeetings();
    }
  }

  async #saveFinish(meetingId: string) {
    if (this.#pendingFinishMs === undefined) return;
    await this.#deps.api.finish(meetingId, this.#pendingFinishMs);
    this.#pendingFinishMs = undefined;
  }

  #onFrame(frame: ArrayBuffer) {
    if (this.#recorder.phase !== 'recording') return;

    const level = frameLevel(frame);
    this.levels.push(level);
    this.#local?.pushFrame(frame);
    this.#transcriber?.enqueue(this.#cutter?.push(frame, level));
    this.#patch({ durationMs: this.#recorder.durationMs + this.#deps.frameMs }, 'frame');
  }

  #createTranscriber(meetingId: string, transcribe: (window: LiveWindow) => Promise<string>) {
    return new LiveTranscriber({
      network: this.#deps.network,
      onSegment: (segment) => {
        this.#segments = [...this.#segments, segment];
        this.#patch({ segments: this.#segments }, 'live/segment');
        void this.#deps.api.appendRealtimeSegments(meetingId, [segment]).catch((error) => {
          console.warn('[meeting:recorder] live segment not saved', error);
        });
      },
      onStatus: ({ pendingWindows, state }) => {
        this.#patch({ live: state, pendingWindows }, 'live/status');
      },
      transcribe,
    });
  }
}
