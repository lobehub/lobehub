import type {
  MeetingActionItem,
  MeetingChapter,
  MeetingDecision,
  MeetingLanguage,
  MeetingPlatform,
  MeetingRealtimeProvider,
  MeetingRefineProvider,
  MeetingSegmentSource,
  MeetingStatus,
  MeetingVisibility,
} from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { documents, files } from './file';
import { users } from './user';
import { workspaces } from './workspace';

// ── Meetings ─────────────────────────────────────────────
//
// `user_id` is the creator; `workspace_id` NULL means personal. Reads follow
// `buildWorkspaceWhere` with `visibility`, so a private meeting in a workspace
// is visible to its creator only. Speakers, segments and minutes are children
// reached through their meeting and carry no scope columns of their own.

/** One recording session: lifecycle, ASR configuration and where its audio lives. */
export const meetings = pgTable(
  'meetings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('meetings'))
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    status: text('status').$type<MeetingStatus>().notNull().default('recording'),
    platform: text('platform').$type<MeetingPlatform>().notNull(),
    /** Engine for the live draft transcript; `none` records audio only. */
    realtimeProvider: text('realtime_provider').$type<MeetingRealtimeProvider>().notNull(),
    /** Engine for the authoritative post-recording transcript. */
    refineProvider: text('refine_provider').$type<MeetingRefineProvider>().notNull(),
    language: text('language').$type<MeetingLanguage>().notNull().default('auto'),

    /** When capture began; `durationMs` excludes paused time, so it can be shorter than `endedAt - startedAt`. */
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    /** Set when the recorder is stopped (`finish`). */
    endedAt: timestamptz('ended_at'),
    /** Recorded audio length in milliseconds, reported by the recorder on finish. */
    durationMs: integer('duration_ms'),

    /**
     * Uploaded recording (`files.source = 'meeting'`). NULL while the upload is
     * in flight, and always NULL in desktop local mode where audio never
     * leaves the machine.
     */
    audioFileId: text('audio_file_id').references(() => files.id, { onDelete: 'set null' }),
    /**
     * Desktop local mode only: absolute path of the recording on the device
     * that captured it, e.g. `~/Library/Application Support/LobeHub/meetings/mtg_x.wav`.
     */
    localAudioPath: text('local_audio_path'),

    visibility: text('visibility').$type<MeetingVisibility>().notNull().default('private'),
    ...timestamps,
  },
  (t) => [
    index('meetings_user_id_workspace_id_created_at_idx').on(t.userId, t.workspaceId, t.createdAt),
    index('meetings_workspace_id_created_at_idx').on(t.workspaceId, t.createdAt),
    index('meetings_audio_file_id_idx').on(t.audioFileId),
  ],
);

/** A distinct voice in a meeting, as labelled by diarization ("Speaker 1"). */
export const meetingSpeakers = pgTable(
  'meeting_speakers',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    meetingId: text('meeting_id')
      .references(() => meetings.id, { onDelete: 'cascade' })
      .notNull(),

    /** Diarization label, stable within the meeting, e.g. `S1` or `Speaker 1`. */
    label: text('label').notNull(),
    /** Name the user gave this speaker; the UI falls back to `label` when empty. */
    displayName: text('display_name'),
    ...timestamps,
  },
  (t) => [uniqueIndex('meeting_speakers_meeting_id_label_unique').on(t.meetingId, t.label)],
);

/** One transcript utterance: who spoke, when (offset from meeting start), and what. */
export const meetingSegments = pgTable(
  'meeting_segments',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    meetingId: text('meeting_id')
      .references(() => meetings.id, { onDelete: 'cascade' })
      .notNull(),
    speakerId: uuid('speaker_id').references(() => meetingSpeakers.id, { onDelete: 'set null' }),

    /** `realtime` draft streamed while recording, or `refine` authoritative pass. */
    source: text('source').$type<MeetingSegmentSource>().notNull(),
    /**
     * Producer-assigned order within (`meeting_id`, `source`), starting at 0.
     * Re-sending the same seq replaces the segment, so retried appends never
     * duplicate text.
     */
    seq: integer('seq').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meeting_segments_meeting_id_source_seq_unique').on(t.meetingId, t.source, t.seq),
    index('meeting_segments_meeting_id_source_start_ms_idx').on(t.meetingId, t.source, t.startMs),
    index('meeting_segments_speaker_id_idx').on(t.speakerId),
  ],
);

/** Generated minutes of a meeting (one row per meeting), every item citing its segments. */
export const meetingMinutes = pgTable(
  'meeting_minutes',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    meetingId: text('meeting_id')
      .references(() => meetings.id, { onDelete: 'cascade' })
      .notNull(),

    summary: text('summary'),
    chapters: jsonb('chapters').$type<MeetingChapter[]>().notNull().default([]),
    decisions: jsonb('decisions').$type<MeetingDecision[]>().notNull().default([]),
    actionItems: jsonb('action_items').$type<MeetingActionItem[]>().notNull().default([]),
    keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
    /** Editable, shareable rendering of the minutes as a page. */
    documentId: text('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Model that generated the minutes, e.g. `openai/gpt-5-mini`. */
    model: text('model'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meeting_minutes_meeting_id_unique').on(t.meetingId),
    index('meeting_minutes_document_id_idx').on(t.documentId),
  ],
);

export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingItem = typeof meetings.$inferSelect;
export type NewMeetingSpeaker = typeof meetingSpeakers.$inferInsert;
export type MeetingSpeakerItem = typeof meetingSpeakers.$inferSelect;
export type NewMeetingSegment = typeof meetingSegments.$inferInsert;
export type MeetingSegmentItem = typeof meetingSegments.$inferSelect;
export type NewMeetingMinutes = typeof meetingMinutes.$inferInsert;
export type MeetingMinutesItem = typeof meetingMinutes.$inferSelect;
