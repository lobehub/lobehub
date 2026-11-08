import type { ModelPricingContext } from './pricing';
import type { OnUsageCallback } from './routeAttempt';

/** A speaker the provider should recognize by name, from a short sample of their voice. */
export interface ASRKnownSpeaker {
  /** Label the provider returns for this voice, e.g. `S1`. */
  name: string;
  /** 2–10 s sample of the voice as a data URL, e.g. `data:audio/wav;base64,…`. */
  reference: string;
}

export interface ASRPayload {
  /**
   * How the provider cuts long audio before transcribing it. Diarizing models
   * such as `gpt-4o-transcribe-diarize` require `auto` for inputs over 30 s.
   */
  chunkingStrategy?: 'auto';
  /**
   * The audio content to transcribe. A `File` is passed through as-is; any other
   * `Blob` is wrapped into a `File` using `fileName` so the provider can infer
   * the format from the extension.
   */
  file: Blob;
  /**
   * Optional file name used when `file` is a plain `Blob`. The extension helps
   * providers detect the audio format (e.g. `audio.mp3`, `speech.m4a`).
   */
  fileName?: string;
  /**
   * Voices to label consistently, so separate requests over one recording keep
   * the same speaker names. Only diarizing models use it (up to 4).
   */
  knownSpeakers?: ASRKnownSpeaker[];
  /**
   * ISO-639-1 language code of the input audio (e.g. `en`, `zh`). Supplying it
   * improves accuracy and latency.
   */
  language?: string;
  model: string;
  /**
   * Optional text to guide the model's style or continue a previous segment.
   */
  prompt?: string;
  /**
   * Transcript output format. Defaults to the provider's default (`json`).
   */
  responseFormat?: 'diarized_json' | 'json' | 'srt' | 'text' | 'verbose_json' | 'vtt';
  /**
   * Sampling temperature between 0 and 1.
   */
  temperature?: number;
}

export interface ASROptions {
  headers?: Record<string, any>;
  /** Metadata passed to hooks (billing, tracing, route attempts), e.g. `trigger`. */
  metadata?: Record<string, unknown>;
  /**
   * Receives the provider-reported token usage (with `cost` when the model has
   * pricing) after a successful transcription.
   */
  onUsage?: OnUsageCallback;
  pricingContext?: ModelPricingContext;
  signal?: AbortSignal;
  /**
   * userId for the request
   */
  user?: string;
}

/** A timed span of the transcript, as returned by `verbose_json` / `diarized_json`. */
export interface ASRSegment {
  /** End offset in seconds from the start of the audio. */
  end: number;
  /** Speaker label from a diarizing model (`A`, `B`, … or a known speaker name). */
  speaker?: string;
  /** Start offset in seconds from the start of the audio. */
  start: number;
  text: string;
}

export interface ASRResponse {
  /** Audio length in seconds, when the provider reports it. */
  duration?: number;
  /** Timed segments, present for `verbose_json` and `diarized_json` responses. */
  segments?: ASRSegment[];
  /**
   * The transcribed text.
   */
  text: string;
}
