// ============================================
// Meeting — recorded meetings, their transcript and minutes
// (`meetings` / `meeting_speakers` / `meeting_segments` / `meeting_minutes`)
// ============================================
//
// A meeting is one recording session. Its transcript is a list of segments
// (speaker + start/end offset + text) written by two producers: the realtime
// draft streamed while recording, and the post-recording refine pass that is
// the authoritative version. Minutes are generated from the refined
// transcript once it lands.

/**
 * Lifecycle of a meeting, in order:
 * `recording` ⇄ `paused` → `uploading` (audio still reaching storage) →
 * `transcribing` (refine pass) → `summarizing` (minutes) → `ready`.
 * Any post-recording stage may end in `failed`.
 */
export const MEETING_STATUSES = [
  'recording',
  'paused',
  'uploading',
  'transcribing',
  'summarizing',
  'ready',
  'failed',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Statuses in which the recorder is still live (segments stream in, pause/resume apply). */
export const MEETING_LIVE_STATUSES = ['recording', 'paused'] as const satisfies MeetingStatus[];

/**
 * Statuses in which the refine pass has finished, so its transcript is complete
 * and becomes the authoritative one. Before that the refine segments on record
 * are only the batches already stored, so reads keep serving the realtime draft.
 */
export const MEETING_REFINED_STATUSES = ['summarizing', 'ready'] as const satisfies MeetingStatus[];

export const MEETING_PLATFORMS = ['web', 'desktop'] as const;
export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number];

/** Engine producing the realtime draft; `none` records audio only. */
export const MEETING_REALTIME_PROVIDERS = ['cloud', 'local', 'none'] as const;
export type MeetingRealtimeProvider = (typeof MEETING_REALTIME_PROVIDERS)[number];

/** Engine producing the authoritative post-recording transcript. */
export const MEETING_REFINE_PROVIDERS = ['cloud', 'local'] as const;
export type MeetingRefineProvider = (typeof MEETING_REFINE_PROVIDERS)[number];

export const MEETING_LANGUAGES = ['auto', 'en', 'zh'] as const;
export type MeetingLanguage = (typeof MEETING_LANGUAGES)[number];

/** Which producer wrote a transcript segment. */
export const MEETING_SEGMENT_SOURCES = ['realtime', 'refine'] as const;
export type MeetingSegmentSource = (typeof MEETING_SEGMENT_SOURCES)[number];

export const MEETING_VISIBILITIES = ['private', 'public'] as const;
export type MeetingVisibility = (typeof MEETING_VISIBILITIES)[number];

/** Pipeline stage a meeting failed in: the refine transcript, or the minutes generated from it. */
export const MEETING_ERROR_STAGES = ['refine', 'minutes'] as const;
export type MeetingErrorStage = (typeof MEETING_ERROR_STAGES)[number];

/**
 * Why a post-recording stage failed, chosen so the UI can say what to fix:
 * `provider_not_configured` → set up the transcription model / key,
 * `quota_exceeded` → top up or wait, `provider_unavailable` → retry later,
 * `audio_missing` / `audio_unsupported` → the recording itself is unusable,
 * `transcript_empty` → nothing was said that minutes could cover.
 */
export const MEETING_ERROR_CODES = [
  'audio_missing',
  'audio_unsupported',
  'provider_not_configured',
  'provider_unavailable',
  'quota_exceeded',
  'summarization_failed',
  'transcript_empty',
  'transcription_failed',
] as const;
export type MeetingErrorCode = (typeof MEETING_ERROR_CODES)[number];

/** Last failure of a meeting's post-recording pipeline; cleared when the stage is retried. */
export interface MeetingError {
  code: MeetingErrorCode;
  /** Provider or server detail, for support; not shown as the primary message. */
  message?: string;
  stage: MeetingErrorStage;
}

/** A titled span of the meeting timeline. */
export interface MeetingChapter {
  endMs: number;
  /** Transcript segments the chapter covers, for playback and citation. */
  segmentIds: string[];
  startMs: number;
  title: string;
}

/** A decision recorded in the minutes, citing the segments it came from. */
export interface MeetingDecision {
  segmentIds: string[];
  text: string;
}

export const MEETING_ACTION_ITEM_STATUSES = ['suggested', 'created', 'dismissed'] as const;
export type MeetingActionItemStatus = (typeof MEETING_ACTION_ITEM_STATUSES)[number];

/** A to-do extracted from the meeting; becomes a LobeHub task once confirmed. */
export interface MeetingActionItem {
  /** Free-text owner the transcript names ("Alice", "我"), before it is mapped to a member. */
  assigneeHint?: string;
  /** ISO date the transcript gives as the deadline, when it gives one. */
  dueDate?: string;
  /** Stable id within the minutes, so a confirmation can address one item. */
  id: string;
  segmentIds: string[];
  /** Speaker label that took the item, when the transcript attributes one. */
  speakerLabel?: string;
  status: MeetingActionItemStatus;
  /** The task created from this item, once `status` is `created`. */
  taskId?: string;
  text: string;
}
