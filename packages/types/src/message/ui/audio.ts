export interface ChatAudioItem {
  alt: string;
  codec?: string;
  /** Validated positive audio duration in milliseconds, when known. */
  durationMs?: number;
  id: string;
  mimeType?: string;
  url: string;
}
