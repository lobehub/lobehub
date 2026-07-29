export interface ASRPayload {
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
  responseFormat?: 'json' | 'srt' | 'text' | 'verbose_json' | 'vtt';
  /**
   * Sampling temperature between 0 and 1.
   */
  temperature?: number;
}

export interface ASROptions {
  headers?: Record<string, any>;
  signal?: AbortSignal;
  /**
   * userId for the request
   */
  user?: string;
}

export interface ASRResponse {
  /**
   * The transcribed text.
   */
  text: string;
}
