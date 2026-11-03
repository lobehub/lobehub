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
import { MEETING_LIVE_STATUSES, MEETING_REFINED_STATUSES } from '@lobechat/types';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { MeetingItem } from '../schemas/meeting';
import { meetingMinutes, meetings, meetingSegments, meetingSpeakers } from '../schemas/meeting';
import type { LobeChatDatabase, Transaction } from '../type';
import { isUuid } from '../utils/uuid';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface CreateMeetingInput {
  language?: MeetingLanguage;
  platform: MeetingPlatform;
  realtimeProvider: MeetingRealtimeProvider;
  refineProvider: MeetingRefineProvider;
  startedAt?: Date;
  title: string;
  /** Workspace mode only; defaults to `private`. Personal meetings ignore it. */
  visibility?: MeetingVisibility;
}

export interface ListMeetingsInput {
  limit?: number;
  offset?: number;
  status?: MeetingStatus;
}

export interface AppendMeetingSegmentInput {
  endMs: number;
  seq: number;
  source: MeetingSegmentSource;
  /** Diarization label; segments sharing a label share one `meeting_speakers` row. */
  speakerLabel?: string | null;
  startMs: number;
  text: string;
}

export interface FinishMeetingInput {
  durationMs?: number;
  endedAt?: Date;
}

/** Exactly one storage location: an uploaded file or a desktop-local path. */
export type AttachMeetingAudioInput = { audioFileId: string } | { localAudioPath: string };

export interface SaveMeetingMinutesInput {
  actionItems?: MeetingActionItem[];
  chapters?: MeetingChapter[];
  decisions?: MeetingDecision[];
  documentId?: string | null;
  keywords?: string[];
  model?: string | null;
  summary?: string | null;
}

/** Raised when a lifecycle call does not fit the meeting's current status. */
export class MeetingStateError extends Error {
  constructor(
    readonly status: MeetingStatus,
    action: string,
  ) {
    super(`Cannot ${action} a meeting in status "${status}"`);
    this.name = 'MeetingStateError';
  }
}

const isLive = (status: MeetingStatus) =>
  (MEETING_LIVE_STATUSES as readonly MeetingStatus[]).includes(status);

/**
 * Meetings with their speakers, transcript segments and minutes.
 *
 * Reads follow `buildWorkspaceWhere` with `visibility`: personal meetings are
 * the creator's; workspace meetings are visible to members when public and to
 * the creator alone when private. Every write is limited to the creator.
 * Child rows (speakers / segments / minutes) are only reached through a
 * meeting that passed one of those checks. Workspace roles are enforced in the
 * router.
 */
export class MeetingModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private get ctx() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private readable() {
    return buildWorkspaceWhere(this.ctx, meetings);
  }

  private manageable() {
    return and(this.readable(), eq(meetings.userId, this.userId));
  }

  private async findManageable(id: string, db: LobeChatDatabase | Transaction = this.db) {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), this.manageable()))
      .limit(1);

    return meeting;
  }

  // ── Meetings ──

  async create(input: CreateMeetingInput) {
    const [meeting] = await this.db
      .insert(meetings)
      .values(
        buildWorkspacePayload(this.ctx, {
          ...input,
          status: 'recording' as const,
          visibility: input.visibility ?? 'private',
        }),
      )
      .returning();

    return meeting;
  }

  async findById(id: string) {
    const [meeting] = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), this.readable()))
      .limit(1);

    return meeting;
  }

  /** Newest first. */
  async list({ limit = 20, offset = 0, status }: ListMeetingsInput = {}) {
    return this.db
      .select()
      .from(meetings)
      .where(and(this.readable(), status ? eq(meetings.status, status) : undefined))
      .orderBy(desc(meetings.createdAt), desc(meetings.id))
      .limit(limit)
      .offset(offset);
  }

  /**
   * A meeting with its speakers, one transcript and its minutes.
   *
   * Without an explicit `source`, the refined transcript is returned once the
   * refine pass has finished (see `MEETING_REFINED_STATUSES`) and the realtime
   * draft until then — segment presence alone is not enough, because a long
   * transcript arrives as several batches and the first one lands while
   * refinement is still running.
   */
  async getDetail(id: string, options: { source?: MeetingSegmentSource } = {}) {
    const meeting = await this.findById(id);
    if (!meeting) return undefined;

    const source = options.source ?? (await this.preferredSegmentSource(meeting));

    const [speakers, segments, [minutes]] = await Promise.all([
      this.db
        .select()
        .from(meetingSpeakers)
        .where(eq(meetingSpeakers.meetingId, id))
        .orderBy(asc(meetingSpeakers.createdAt), asc(meetingSpeakers.label)),
      this.db
        .select()
        .from(meetingSegments)
        .where(and(eq(meetingSegments.meetingId, id), eq(meetingSegments.source, source)))
        .orderBy(asc(meetingSegments.startMs), asc(meetingSegments.seq)),
      this.db.select().from(meetingMinutes).where(eq(meetingMinutes.meetingId, id)).limit(1),
    ]);

    return { ...meeting, minutes: minutes ?? null, segmentSource: source, segments, speakers };
  }

  async rename(id: string, title: string) {
    const [meeting] = await this.db
      .update(meetings)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(meetings.id, id), this.manageable()))
      .returning();

    return meeting;
  }

  /** Hard delete; speakers, segments and minutes cascade. Returns the removed row. */
  async delete(id: string) {
    const [meeting] = await this.db
      .delete(meetings)
      .where(and(eq(meetings.id, id), this.manageable()))
      .returning();

    return meeting;
  }

  // ── Lifecycle ──

  /** `recording` → `paused`. */
  async pause(id: string) {
    return this.transition(id, 'pause', (status) => (status === 'recording' ? 'paused' : null));
  }

  /** `paused` → `recording`. */
  async resume(id: string) {
    return this.transition(id, 'resume', (status) => (status === 'paused' ? 'recording' : null));
  }

  /**
   * Stop the recorder. The meeting moves on to `transcribing` when its audio
   * is already stored, otherwise to `uploading` until `attachAudio` lands.
   */
  async finish(id: string, input: FinishMeetingInput = {}) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (!isLive(meeting.status)) throw new MeetingStateError(meeting.status, 'finish');

      const hasAudio = !!meeting.audioFileId || !!meeting.localAudioPath;
      const [updated] = await tx
        .update(meetings)
        .set({
          durationMs: input.durationMs ?? meeting.durationMs,
          endedAt: input.endedAt ?? new Date(),
          status: hasAudio ? 'transcribing' : 'uploading',
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  /**
   * Record where the meeting audio is stored. Setting one location clears the
   * other. A meeting waiting in `uploading` moves on to `transcribing`.
   *
   * The caller must have checked that `audioFileId` is a file it may read.
   */
  async attachAudio(id: string, input: AttachMeetingAudioInput) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;

      const location =
        'audioFileId' in input
          ? { audioFileId: input.audioFileId, localAudioPath: null }
          : { audioFileId: null, localAudioPath: input.localAudioPath };

      const [updated] = await tx
        .update(meetings)
        .set({
          ...location,
          status: meeting.status === 'uploading' ? 'transcribing' : meeting.status,
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  // ── Transcript ──

  /**
   * Insert or replace transcript segments, keyed by (`source`, `seq`), so a
   * retried batch never duplicates text. Speakers are created on first use of
   * a label. Returns the stored segments in input order, or `undefined` when
   * the meeting is not the caller's.
   */
  async appendSegments(meetingId: string, segments: AppendMeetingSegmentInput[]) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(meetingId, tx);
      if (!meeting) return undefined;
      if (segments.length === 0) return [];

      // One statement cannot upsert the same key twice; the last copy in the batch wins.
      const batch = [
        ...new Map(
          segments.map((segment) => [`${segment.source}:${segment.seq}`, segment]),
        ).values(),
      ];

      const speakerIds = await this.ensureSpeakers(
        tx,
        meetingId,
        batch.map((segment) => segment.speakerLabel).filter((label): label is string => !!label),
      );

      const now = new Date();
      const rows = await tx
        .insert(meetingSegments)
        .values(
          batch.map((segment) => ({
            endMs: segment.endMs,
            meetingId,
            seq: segment.seq,
            source: segment.source,
            speakerId: segment.speakerLabel ? speakerIds.get(segment.speakerLabel) : null,
            startMs: segment.startMs,
            text: segment.text,
          })),
        )
        .onConflictDoUpdate({
          set: {
            endMs: sql`excluded.end_ms`,
            speakerId: sql`excluded.speaker_id`,
            startMs: sql`excluded.start_ms`,
            text: sql`excluded.text`,
            updatedAt: now,
          },
          target: [meetingSegments.meetingId, meetingSegments.source, meetingSegments.seq],
        })
        .returning();

      await tx.update(meetings).set({ updatedAt: now }).where(eq(meetings.id, meetingId));

      const byKey = new Map(rows.map((row) => [`${row.source}:${row.seq}`, row]));
      return segments.map((segment) => byKey.get(`${segment.source}:${segment.seq}`)!);
    });
  }

  /** Name a diarized speaker; an empty name falls back to the label in the UI. */
  async renameSpeaker(meetingId: string, speakerId: string, displayName: string | null) {
    if (!isUuid(speakerId)) return undefined;
    const meeting = await this.findManageable(meetingId);
    if (!meeting) return undefined;

    const [speaker] = await this.db
      .update(meetingSpeakers)
      .set({ displayName, updatedAt: new Date() })
      .where(and(eq(meetingSpeakers.id, speakerId), eq(meetingSpeakers.meetingId, meetingId)))
      .returning();

    return speaker;
  }

  // ── Minutes ──

  /** Create or replace the meeting's minutes; omitted fields keep their stored value. */
  async saveMinutes(meetingId: string, input: SaveMeetingMinutesInput) {
    const meeting = await this.findManageable(meetingId);
    if (!meeting) return undefined;

    const values = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as SaveMeetingMinutesInput;

    const [minutes] = await this.db
      .insert(meetingMinutes)
      .values({ ...values, meetingId })
      .onConflictDoUpdate({
        set: { ...values, updatedAt: new Date() },
        target: meetingMinutes.meetingId,
      })
      .returning();

    return minutes;
  }

  // ── Internals ──

  private async lockManageable(id: string, tx: Transaction): Promise<MeetingItem | undefined> {
    const [meeting] = await tx
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), this.manageable()))
      .limit(1)
      .for('update');

    return meeting;
  }

  private async transition(
    id: string,
    action: string,
    next: (status: MeetingStatus) => MeetingStatus | null,
  ) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;

      const status = next(meeting.status);
      if (!status) throw new MeetingStateError(meeting.status, action);

      const [updated] = await tx
        .update(meetings)
        .set({ status, updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  private async ensureSpeakers(tx: Transaction, meetingId: string, labels: string[]) {
    const unique = [...new Set(labels)];
    if (unique.length === 0) return new Map<string, string>();

    await tx
      .insert(meetingSpeakers)
      .values(unique.map((label) => ({ label, meetingId })))
      .onConflictDoNothing({ target: [meetingSpeakers.meetingId, meetingSpeakers.label] });

    const rows = await tx
      .select({ id: meetingSpeakers.id, label: meetingSpeakers.label })
      .from(meetingSpeakers)
      .where(and(eq(meetingSpeakers.meetingId, meetingId), inArray(meetingSpeakers.label, unique)));

    return new Map(rows.map((row) => [row.label, row.id]));
  }

  private async preferredSegmentSource(
    meeting: Pick<MeetingItem, 'id' | 'status'>,
  ): Promise<MeetingSegmentSource> {
    if (!(MEETING_REFINED_STATUSES as readonly MeetingStatus[]).includes(meeting.status)) {
      return 'realtime';
    }

    const [refined] = await this.db
      .select({ id: meetingSegments.id })
      .from(meetingSegments)
      .where(and(eq(meetingSegments.meetingId, meeting.id), eq(meetingSegments.source, 'refine')))
      .limit(1);

    return refined ? 'refine' : 'realtime';
  }
}
