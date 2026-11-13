import type { ILobeAgentRuntimeErrorType } from './error';

/**
 * Provider-neutral music generation params. Each provider maps the fields it supports and
 * ignores the rest, so the same payload can target Suno or MiniMax Music.
 */
export interface MusicGenerationParams {
  /** Output sample bitrate (MiniMax `audio_setting.bitrate`) */
  bitrate?: number;
  /** Output container (MiniMax `audio_setting.format`) */
  format?: 'mp3' | 'pcm' | 'wav';
  /** Generate an instrumental track without vocals */
  instrumental?: boolean;
  /** Song lyrics, optionally with structure tags such as `[Verse]` / `[Chorus]` */
  lyrics?: string;
  /** Let the provider write lyrics from `prompt` when `lyrics` is empty (MiniMax) */
  lyricsOptimizer?: boolean;
  /** Styles to avoid (Suno `negativeTags`) */
  negativeStyle?: string;
  /** How MiniMax returns audio: a temporary URL or hex-encoded bytes */
  outputFormat?: 'hex' | 'url';
  /** Free-form description of the song: mood, scene, genre */
  prompt?: string;
  /** Base64-encoded reference audio (MiniMax cover models) */
  referenceAudioBase64?: string;
  /** Publicly reachable reference audio URL (MiniMax cover / Suno audio reference) */
  referenceAudioUrl?: string;
  /** Output sample rate (MiniMax `audio_setting.sample_rate`) */
  sampleRate?: number;
  /** Receive the audio as a server-sent event stream and assemble it (MiniMax) */
  stream?: boolean;
  /** Style tags such as `lo-fi, female vocals, 90 bpm` (Suno `style`) */
  style?: string;
  /** Song title (Suno custom mode) */
  title?: string;
  /** Preferred vocal gender (Suno custom mode) */
  vocalGender?: 'f' | 'm';
  /** Add the provider's AIGC watermark */
  watermark?: boolean;
}

export interface CreateMusicPayload {
  /** LobeHub model id, e.g. `music-2.6` or `suno-v5` */
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
  /** Webhook the provider calls on completion (Suno requires one even when polling) */
  callbackUrl?: string;
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
  | { inferenceId: string; status: 'pending' };
