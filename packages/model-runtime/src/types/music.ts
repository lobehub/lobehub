import type { ILobeAgentRuntimeErrorType } from './error';

/**
 * Provider-neutral music generation params. Each provider maps the fields it supports and
 * ignores the rest, so the same payload can target any music provider.
 */
export interface MusicGenerationParams {
  /** Output sample bitrate */
  bitrate?: number;
  /** Target song length in seconds */
  duration?: number;
  /** Output container */
  format?: 'mp3' | 'pcm' | 'wav';
  /** Generate an instrumental track without vocals */
  instrumental?: boolean;
  /** Song lyrics, optionally with structure tags such as `[Verse]` / `[Chorus]` */
  lyrics?: string;
  /** Let the provider write lyrics from `prompt` when `lyrics` is empty */
  lyricsOptimizer?: boolean;
  /** Styles to avoid */
  negativeStyle?: string;
  /** How the provider returns audio: a temporary URL or hex-encoded bytes */
  outputFormat?: 'hex' | 'url';
  /** Free-form description of the song: mood, scene, genre */
  prompt?: string;
  /** Base64-encoded reference audio */
  referenceAudioBase64?: string;
  /** Publicly reachable reference audio URL */
  referenceAudioUrl?: string;
  /** Output sample rate */
  sampleRate?: number;
  /** Receive the audio as a server-sent event stream and assemble it */
  stream?: boolean;
  /** Style tags such as `lo-fi, female vocals, 90 bpm` */
  style?: string;
  /** Song title */
  title?: string;
  /** Preferred vocal gender */
  vocalGender?: 'f' | 'm';
  /** Add the provider's AIGC watermark */
  watermark?: boolean;
}

export interface CreateMusicPayload {
  /** LobeHub model id */
  model: string;
  params: MusicGenerationParams;
}

export interface MusicPollingOptions {
  /** Upper bound on status queries before the task is reported as timed out */
  maxAttempts?: number;
  /** Delay between two status queries */
  pollIntervalMs?: number;
  /** Total wall-clock budget for the task before it is reported as timed out */
  timeoutMs?: number;
}

export interface CreateMusicOptions extends MusicPollingOptions {
  /** Webhook the provider calls on completion. Some providers require it even when polling. */
  callbackUrl?: string;
  /** Request metadata (e.g. `trigger`) the router records on the route attempt. */
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  /**
   * For asynchronous providers: poll until the task finishes and return the tracks instead
   * of a pending `inferenceId`.
   */
  waitForCompletion?: boolean;
}

export interface MusicTrack {
  /** Raw audio bytes, set when the provider returned the audio inline (hex) */
  audio?: ArrayBuffer;
  /** Playable audio URL, set when the provider hosts the file */
  audioUrl?: string;
  /** MIME type of `audio` / `audioUrl`, e.g. `audio/mpeg` */
  contentType?: string;
  /** Track length in seconds */
  duration?: number;
  id?: string;
  /** Cover art URL */
  imageUrl?: string;
  /** Progressive playback URL available before the final file is ready */
  streamAudioUrl?: string;
  tags?: string;
  title?: string;
}

/**
 * Channel that accepted an asynchronous music task. Router runtimes return it with a pending
 * result; pass it back to `handlePollMusicStatus` so polling reaches the same channel.
 */
/** Per-request options for a single status query. */
export interface PollMusicStatusOptions {
  /** Aborts the in-flight status request, e.g. when the caller's task deadline passes */
  signal?: AbortSignal;
}

export interface MusicPollingRoute {
  channelId?: string;
  /** Position of an id-less channel in its router's option list */
  channelIndex?: number;
  /** Model the task was submitted with, so model-dependent routers resolve the same router */
  model?: string;
  routerId?: string;
}

/** Status of an asynchronous music generation task */
export type MusicTaskStatus = 'failed' | 'pending' | 'success';

export type PollMusicStatusResult =
  | { status: 'pending' }
  | { status: 'success'; tracks: MusicTrack[] }
  | { error: string; errorType: ILobeAgentRuntimeErrorType; status: 'failed' };

/**
 * `success` carries playable tracks; `pending` carries the provider task id to pass to
 * `handlePollMusicStatus` (or a webhook) later.
 */
export type CreateMusicResult =
  | { inferenceId?: string; status: 'success'; tracks: MusicTrack[] }
  | { inferenceId: string; route?: MusicPollingRoute; status: 'pending' };
