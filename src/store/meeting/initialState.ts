import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { MeetingDetail, MeetingListItem } from '@/services/meeting';

/**
 * Where the app-wide recorder is. A recording lives outside any route, so this
 * state (not a component) is what the floating recorder and the home entry read.
 *
 * `idle` → `requesting_permission` → `recording` ⇄ `paused` → `finishing` →
 * `done`. A failed start returns to `idle` with `error` set.
 */
export type RecorderPhase =
  'idle' | 'requesting_permission' | 'recording' | 'paused' | 'finishing' | 'done';

/** Failures the recorder shows, each with its own way out. */
export type RecorderErrorCode =
  /** The browser or OS refused the microphone; the guide explains how to allow it. */
  | 'permission_denied'
  /** No input device is connected. */
  | 'no_device'
  /** This runtime cannot capture audio at all. */
  | 'not_supported'
  /** The meeting could not be created; retry the start. */
  | 'start_failed'
  /** The audio could not be uploaded; the recording is kept for a retry. */
  | 'upload_failed'
  /** As `upload_failed`, because the connection is down; retry once back online. */
  | 'upload_offline';

/**
 * Health of the live transcript. Recording never depends on it:
 * - `live`: windows are being transcribed as they close.
 * - `unavailable`: no speech-to-text model is configured, so only audio is kept.
 * - `lagging`: the last window failed; later windows keep going.
 */
export type LiveTranscriptState = 'live' | 'unavailable' | 'lagging' | 'offline';

/** A finished piece of the live draft, offsets in ms from the start of the recording. */
export interface LiveSegment {
  endMs: number;
  seq: number;
  startMs: number;
  text: string;
}

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface MeetingRecorderState {
  /** Audio recorded so far, paused time excluded. */
  durationMs: number;
  error?: RecorderErrorCode;
  live: LiveTranscriptState;
  meetingId?: string;
  /** Windows recorded but not transcribed yet. */
  pendingWindows: number;
  phase: RecorderPhase;
  segments: LiveSegment[];
  title?: string;
}

export interface MeetingOverlayState {
  minimized: boolean;
  open: boolean;
  /** Minimized chip position; unset docks it to the bottom-right corner. */
  pillPosition?: { x: number; y: number };
  /** Top-left corner of the expanded card in viewport pixels; unset docks it to the bottom-right corner. */
  position?: { x: number; y: number };
}

export interface MeetingState {
  devices: MicrophoneDevice[];
  meetingDetailMap: Record<string, MeetingDetail>;
  meetingDetailReplica: ReplicaState<MeetingDetail>;
  meetingListMap: Record<string, MeetingListItem[]>;
  meetingListReplica: ReplicaState<MeetingListItem[]>;
  overlay: MeetingOverlayState;
  permission: MicrophonePermission;
  recorder: MeetingRecorderState;
  /** Chosen input; unset uses the system default. */
  selectedDeviceId?: string;
}

export const initialRecorderState: MeetingRecorderState = {
  durationMs: 0,
  live: 'live',
  pendingWindows: 0,
  phase: 'idle',
  segments: [],
};

export const initialState: MeetingState = {
  devices: [],
  meetingDetailMap: {},
  meetingDetailReplica: createReplicaState(),
  meetingListMap: {},
  meetingListReplica: createReplicaState(),
  overlay: { minimized: false, open: false },
  permission: 'unknown',
  recorder: initialRecorderState,
};
