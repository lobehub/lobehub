import { REALTIME_ASR_AUDIO } from '@/features/ChatInput/Dictation/contract';

/** Every captured frame is 200 ms of 16 kHz mono PCM16, as the realtime ASR protocol fixes. */
export const FRAME_MS = REALTIME_ASR_AUDIO.frameDurationMs;
export const FRAME_BYTES = REALTIME_ASR_AUDIO.frameBytes;
export const SAMPLE_RATE = REALTIME_ASR_AUDIO.sampleRate;

/** Offset of frame `index` from the start of the recording (paused time excluded). */
export const frameToMs = (index: number) => index * FRAME_MS;

/**
 * Why live transcription stopped making progress. Recording keeps going in
 * every case; the recovery differs:
 * - `network`: retried automatically once the connection is back.
 * - `provider_unavailable`: retried automatically with backoff.
 * - `quota_exceeded` / `provider_not_configured` / `auth`: needs the user
 *   (top up, configure a model, sign in), then a manual retry that catches up
 *   on everything recorded meanwhile.
 */
export type LiveErrorCode =
  'auth' | 'network' | 'provider_not_configured' | 'provider_unavailable' | 'quota_exceeded';

export type LiveTranscriberState =
  /** Idle, or keeping up with the recording. */
  | 'live'
  /** Lost the connection; waiting `retryInMs` before trying again. */
  | 'reconnecting'
  /** Stopped until the user fixes `errorCode` and retries. */
  | 'blocked';

export interface LiveTranscriberStatus {
  errorCode?: LiveErrorCode;
  /** Audio recorded but not transcribed yet, in ms. */
  pendingMs: number;
  retryInMs?: number;
  state: LiveTranscriberState;
}

/** A finished piece of the live draft, offsets in ms from the start of the recording. */
export interface LiveSegment {
  endMs: number;
  /** Order within the realtime transcript; re-sending a seq replaces it. */
  seq: number;
  startMs: number;
  text: string;
}

export interface LiveTranscriberEvents {
  /** Segments finished, in `seq` order. */
  onSegments: (segments: LiveSegment[]) => void;
  onStatus: (status: LiveTranscriberStatus) => void;
  /** Text still being recognized after the last segment; `''` clears it. */
  onTail?: (text: string) => void;
}

/**
 * Turns the frames of a `FrameLedger` into the live draft transcript.
 *
 * Implementations own the guarantee that every recorded frame is transcribed
 * exactly once in the committed draft: work lost to a failure is redone from
 * the ledger, and work that is redone replaces (never appends to) what an
 * earlier attempt produced.
 */
export interface LiveTranscriber {
  /** Close sockets and timers for good; pending work is abandoned. */
  readonly dispose: () => void;
  /** Transcribe everything recorded so far, waiting at most `timeoutMs`. */
  readonly drain: (timeoutMs: number) => Promise<boolean>;
  /** A frame was appended to the ledger. */
  readonly notifyFrame: () => void;
  /** Recording paused: close the open window at the current frame. */
  readonly pause: () => void;
  /** Retry now, ignoring backoff and blocked errors. */
  readonly retry: () => void;
  readonly start: () => void;
}

/** Retry delays after consecutive failures; the last value repeats. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

export const retryDelay = (attempt: number) =>
  RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
