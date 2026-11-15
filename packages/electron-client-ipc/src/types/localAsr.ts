/**
 * Local (on-device) ASR engine shared by the desktop main process and renderer.
 *
 * Audio frames follow the cloud realtime ASR contract: 16 kHz mono pcm_s16le,
 * 200 ms (6400 B) per frame. Transcript events reuse the cloud v1 server event
 * vocabulary (`transcript.partial` / `transcript.final` with `segmentId` + `text`)
 * so both providers can sit behind the same transcriber interface.
 */

export type TranscriptionProvider = 'cloud' | 'local';

export type LocalAsrLanguage = 'auto' | 'en' | 'ja' | 'ko' | 'yue' | 'zh';

export type LocalAsrModelPackId = 'asr-sensevoice' | 'diarization';

export type LocalAsrModelPackStatus =
  'corrupted' | 'downloading' | 'not_downloaded' | 'ready' | 'verifying';

export interface LocalAsrModelFileState {
  /** Bytes present on disk (final file or in-progress `.part`) */
  downloadedBytes: number;
  name: string;
  sha256: string;
  size: number;
}

export interface LocalAsrModelPackState {
  /** Short engine / model description, e.g. "SenseVoice-small int8 + silero VAD" */
  description: string;
  downloadedBytes: number;
  error?: string;
  files: LocalAsrModelFileState[];
  id: LocalAsrModelPackId;
  /** Whether the pack is required for local transcription */
  required: boolean;
  status: LocalAsrModelPackStatus;
  totalBytes: number;
}

export interface LocalAsrModelProgressPayload {
  downloadedBytes: number;
  error?: string;
  /** File currently being downloaded or verified */
  file?: string;
  id: LocalAsrModelPackId;
  /** Bytes per second averaged over the current file */
  speed?: number;
  status: LocalAsrModelPackStatus;
  totalBytes: number;
}

export type LocalAsrHardwareTier = 'limited' | 'recommended' | 'supported' | 'unsupported';

export type LocalAsrHardwareReason =
  | 'apple_silicon'
  | 'low_disk'
  | 'low_memory'
  | 'native_runtime_missing'
  | 'unsupported_platform'
  | 'untested_platform';

export interface LocalAsrHardwareInfo {
  arch: string;
  cpuCores: number;
  cpuModel: string;
  /** Free bytes on the volume holding the model directory, if known */
  freeDiskBytes?: number;
  platform: string;
  reasons: LocalAsrHardwareReason[];
  /** Bytes the recommended packs need on disk */
  requiredDiskBytes: number;
  /** Whether the native sherpa-onnx runtime ships for this platform/arch */
  runtimeAvailable: boolean;
  tier: LocalAsrHardwareTier;
  totalMemoryBytes: number;
}

export interface LocalAsrPreferences {
  /** Run speaker diarization locally when transcribing a recording */
  diarization: boolean;
  language: LocalAsrLanguage;
  provider: TranscriptionProvider;
}

export interface LocalAsrStatus {
  hardware: LocalAsrHardwareInfo;
  modelDir: string;
  packs: LocalAsrModelPackState[];
  preferences: LocalAsrPreferences;
}

export interface LocalAsrStartSessionParams {
  language?: LocalAsrLanguage;
  /** Keep a local WAV copy of the session audio for later refinement */
  recordAudio?: boolean;
}

export interface LocalAsrStartSessionResult {
  sessionId: string;
}

export interface LocalAsrPushAudioParams {
  /** pcm_s16le, 16 kHz mono; usually one 200 ms frame */
  frame: ArrayBuffer | Uint8Array;
  sessionId: string;
}

export interface LocalAsrSessionParams {
  sessionId: string;
}

export interface LocalAsrSessionStats {
  audioMs: number;
  decodeMaxMs: number;
  /** Median decode latency of one utterance (ms) */
  decodeP50Ms: number;
  /** Total decode time / audio duration */
  rtf: number;
  segments: number;
}

export interface LocalAsrStopSessionResult {
  /** Local WAV path, when `recordAudio` was requested */
  audioPath?: string;
  stats: LocalAsrSessionStats;
}

interface LocalAsrEventBase {
  /** Monotonic per-session sequence, starting at 1 */
  sequence: number;
  /** UUID v4 */
  sessionId: string;
}

export interface LocalAsrTranscriptEvent extends LocalAsrEventBase {
  endMs: number;
  segmentId: string;
  startMs: number;
  text: string;
  type: 'transcript.final' | 'transcript.partial';
}

export interface LocalAsrReadyEvent extends LocalAsrEventBase {
  engine: string;
  loadMs: number;
  type: 'session.ready';
}

export interface LocalAsrCompletedEvent extends LocalAsrEventBase {
  audioPath?: string;
  forwardedAudioMs: number;
  stats: LocalAsrSessionStats;
  type: 'session.completed';
}

export interface LocalAsrErrorEvent extends LocalAsrEventBase {
  code: 'ENGINE_CRASHED' | 'INTERNAL_ERROR' | 'MODEL_NOT_READY' | 'RUNTIME_UNAVAILABLE';
  message?: string;
  retryable: boolean;
  type: 'session.error';
}

export type LocalAsrRealtimeEvent =
  LocalAsrCompletedEvent | LocalAsrErrorEvent | LocalAsrReadyEvent | LocalAsrTranscriptEvent;

export interface LocalAsrTranscribeFileParams {
  diarize?: boolean;
  /** Absolute path to a local WAV file */
  filePath: string;
  jobId?: string;
  language?: LocalAsrLanguage;
}

export interface LocalAsrTranscriptSegment {
  endMs: number;
  id: string;
  /** "speaker_1", "speaker_2", … numbered by first appearance */
  speaker?: string;
  startMs: number;
  text: string;
}

export interface LocalAsrTranscribeFileResult {
  audioMs: number;
  segments: LocalAsrTranscriptSegment[];
  speakers: string[];
  stats: {
    asrMs: number;
    diarizationMs?: number;
    engine: string;
    loadMs: number;
    peakRssMb: number;
    rtf: number;
    totalMs: number;
  };
}

export interface LocalAsrJobProgressPayload {
  jobId: string;
  phase: 'diarization' | 'loading' | 'merging' | 'transcribing';
  /** 0..1 */
  progress: number;
}
