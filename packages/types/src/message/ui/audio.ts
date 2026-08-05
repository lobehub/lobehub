export interface ChatAudioItem {
  alt: string;
  /** Validated positive audio duration in milliseconds, when known. */
  durationMs?: number;
  id: string;
  url: string;
}
