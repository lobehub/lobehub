/**
 * Provider-agnostic transcription interface for meeting notes.
 *
 * Every provider consumes the same audio contract as cloud realtime dictation
 * (`src/features/ChatInput/Dictation/contract.ts`, REALTIME_ASR_AUDIO): 16 kHz
 * mono pcm_s16le in 200 ms frames. Every provider reports text with the cloud
 * protocol's semantics: zero or more `partial` updates for a segment, then one
 * `final` carrying the same segment id.
 */

export type TranscriptionProvider = 'cloud' | 'local';

export interface TranscriptSegment {
  endMs?: number;
  id: string;
  speaker?: string;
  startMs?: number;
  text: string;
}

export interface TranscriberError {
  code: string;
  message?: string;
  retryable: boolean;
}

export interface RealtimeTranscriberStartOptions {
  language?: string;
  onError?: (error: TranscriberError) => void;
  onFinal: (segment: TranscriptSegment) => void;
  onPartial?: (segment: TranscriptSegment) => void;
  /** Keep the session audio for a later refine pass (local provider: stays on this device) */
  recordAudio?: boolean;
}

export interface RealtimeTranscriberStats {
  audioMs: number;
  decodeMaxMs?: number;
  decodeP50Ms?: number;
  rtf?: number;
  segments: number;
}

export interface RealtimeTranscriberResult {
  /** Local recording path (local provider with `recordAudio`) */
  audioPath?: string;
  stats?: RealtimeTranscriberStats;
}

export interface RealtimeTranscriber {
  cancel: () => Promise<void>;
  pause: () => void;
  readonly provider: TranscriptionProvider;
  /** One 200 ms pcm_s16le frame; frames pushed before `start` resolves are queued */
  pushFrame: (frame: ArrayBuffer) => void;
  resume: () => void;
  start: (options: RealtimeTranscriberStartOptions) => Promise<void>;
  stop: () => Promise<RealtimeTranscriberResult>;
}

export type BatchTranscriptionPhase = 'diarization' | 'loading' | 'merging' | 'transcribing';

export interface BatchTranscriptionInput {
  diarize?: boolean;
  /** Local file path (desktop) */
  filePath: string;
  language?: string;
  onProgress?: (progress: { phase: BatchTranscriptionPhase; progress: number }) => void;
}

export interface BatchTranscriptionResult {
  audioMs: number;
  segments: TranscriptSegment[];
  speakers: string[];
  stats?: Record<string, number | string | undefined>;
}

export interface BatchTranscriber {
  readonly provider: TranscriptionProvider;
  transcribe: (input: BatchTranscriptionInput) => Promise<BatchTranscriptionResult>;
}
