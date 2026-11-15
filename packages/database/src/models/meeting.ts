import type {
  MeetingActionItem,
  MeetingChapter,
  MeetingDecision,
  MeetingError,
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

/** Statuses minutes may be (re)generated from: the transcript is final. */
const SUMMARIZABLE_STATUSES = new Set<MeetingStatus>(['ready', 'summarizing']);

/** Statuses a refine pass may (re)start from: audio is stored and nothing is recording. */
const REFINABLE_STATUSES = new Set<MeetingStatus>(['failed', 'ready', 'transcribing']);

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

  /**
   * Desktop local mode keeps the recording on the machine that captured it, so
   * `local_audio_path` is only meaningful — and only safe — for the creator.
   * A workspace member reading a public meeting gets the row without it.
   */
  private forCaller<T extends MeetingItem>(meeting: T): T {
    if (meeting.userId === this.userId) return meeting;

    return { ...meeting, localAudioPath: null };
  }

  private async findManageable(id: string, db: LobeChatDatabase | Transaction = this.db) {
    if (!isUuid(id)) return undefined;

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
    if (!isUuid(id)) return undefined;

    const [meeting] = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), this.readable()))
      .limit(1);

    return meeting;
  }

  /** Newest first. */
  async list({ limit = 20, offset = 0, status }: ListMeetingsInput = {}) {
    const rows = await this.db
      .select()
      .from(meetings)
      .where(and(this.readable(), status ? eq(meetings.status, status) : undefined))
      .orderBy(desc(meetings.createdAt), desc(meetings.id))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => this.forCaller(row));
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

    return {
      ...this.forCaller(meeting),
      minutes: minutes ?? null,
      segmentSource: source,
      segments,
      speakers,
    };
  }

  async rename(id: string, title: string) {
    if (!isUuid(id)) return undefined;

    const [meeting] = await this.db
      .update(meetings)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(meetings.id, id), this.manageable()))
      .returning();

    return meeting;
  }

  /** Hard delete; speakers, segments and minutes cascade. Returns the removed row. */
  async delete(id: string) {
    if (!isUuid(id)) return undefined;

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

  /**
   * The refine pass finished: `transcribing` → `summarizing`.
   *
   * Nothing else leaves `transcribing`, so a caller that stored every refined
   * batch had no way to make reads serve it (see `MEETING_REFINED_STATUSES`)
   * and had to write `meetings.status` directly. Segments are written by
   * `appendSegments`; this only advances the lifecycle, so the minutes can then
   * be saved on top of the refined transcript.
   */
  async completeRefinement(id: string) {
    return this.transition(id, 'complete the refinement of', (status) =>
      status === 'transcribing' ? 'summarizing' : null,
    );
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

      const rows = await this.upsertSegments(tx, meetingId, batch);
      await tx.update(meetings).set({ updatedAt: new Date() }).where(eq(meetings.id, meetingId));

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

  // ── Refine ──

  /**
   * Enter `transcribing` for a refine pass and clear the previous failure.
   * Allowed once audio is stored and recording has stopped, including a retry
   * after `failed` or a re-run over a `ready` meeting.
   */
  async startRefine(id: string) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (!REFINABLE_STATUSES.has(meeting.status)) {
        throw new MeetingStateError(meeting.status, 'refine');
      }

      const [updated] = await tx
        .update(meetings)
        .set({ error: null, status: 'transcribing', updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  /**
   * Replace the whole refined transcript in one transaction and mark the
   * meeting `ready` — or `summarizing` when minutes are generated next, so a
   * reader polling the meeting never sees a `ready` without minutes. Re-running
   * a refine therefore never leaves segments of an earlier pass behind. The
   * realtime draft is kept for comparison.
   */
  async completeRefine(
    id: string,
    segments: Omit<AppendMeetingSegmentInput, 'source'>[],
    options: { next?: 'ready' | 'summarizing' } = {},
  ) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (meeting.status !== 'transcribing') {
        throw new MeetingStateError(meeting.status, 'complete the refine of');
      }

      await tx
        .delete(meetingSegments)
        .where(and(eq(meetingSegments.meetingId, id), eq(meetingSegments.source, 'refine')));
      if (segments.length > 0) {
        await this.upsertSegments(
          tx,
          id,
          segments.map((segment) => ({ ...segment, source: 'refine' as const })),
        );
      }

      const [updated] = await tx
        .update(meetings)
        .set({ error: null, status: options.next ?? 'ready', updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  /** Record why the refine pass failed; the meeting moves to `failed` until retried. */
  async failRefine(id: string, error: MeetingError) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (meeting.status !== 'transcribing') {
        throw new MeetingStateError(meeting.status, 'fail the refine of');
      }

      const [updated] = await tx
        .update(meetings)
        .set({ error, status: 'failed', updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  // ── Minutes ──

  /**
   * Enter `summarizing` for a minutes pass and clear the previous failure.
   * Allowed once the transcript is final (`ready`), and while `summarizing`
   * so a pass interrupted mid-way can be run again.
   */
  async startMinutes(id: string) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (!SUMMARIZABLE_STATUSES.has(meeting.status)) {
        throw new MeetingStateError(meeting.status, 'summarize');
      }

      const [updated] = await tx
        .update(meetings)
        .set({ error: null, status: 'summarizing', updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  /** Store the generated minutes and mark the meeting `ready`, in one transaction. */
  async completeMinutes(id: string, input: SaveMeetingMinutesInput) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (!SUMMARIZABLE_STATUSES.has(meeting.status)) {
        throw new MeetingStateError(meeting.status, 'complete the minutes of');
      }

      const now = new Date();
      const [minutes] = await tx
        .insert(meetingMinutes)
        .values({ ...input, meetingId: id })
        .onConflictDoUpdate({ set: { ...input, updatedAt: now }, target: meetingMinutes.meetingId })
        .returning();

      const [updated] = await tx
        .update(meetings)
        .set({ error: null, status: 'ready', updatedAt: now })
        .where(eq(meetings.id, id))
        .returning();

      return { meeting: updated, minutes };
    });
  }

  /**
   * Record why minutes generation failed. The meeting stays `ready` — its
   * transcript is complete and readable — with `error.stage = 'minutes'`
   * until a retry succeeds.
   */
  async failMinutes(id: string, error: MeetingError) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(id, tx);
      if (!meeting) return undefined;
      if (!SUMMARIZABLE_STATUSES.has(meeting.status)) {
        throw new MeetingStateError(meeting.status, 'fail the minutes of');
      }

      const [updated] = await tx
        .update(meetings)
        .set({ error, status: 'ready', updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();

      return updated;
    });
  }

  /**
   * Read-modify-write the action items under a row lock, so two confirmations
   * of the same minutes (two tabs, a retry) never overwrite each other's task
   * links. `update` receives the stored items and returns the new list.
   */
  async updateActionItems(
    meetingId: string,
    update: (items: MeetingActionItem[]) => MeetingActionItem[],
  ) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(meetingId, tx);
      if (!meeting) return undefined;

      const [minutes] = await tx
        .select()
        .from(meetingMinutes)
        .where(eq(meetingMinutes.meetingId, meetingId))
        .limit(1)
        .for('update');
      if (!minutes) return undefined;

      const [updated] = await tx
        .update(meetingMinutes)
        .set({ actionItems: update(minutes.actionItems), updatedAt: new Date() })
        .where(eq(meetingMinutes.id, minutes.id))
        .returning();

      return updated;
    });
  }

  /**
   * Create or replace the meeting's minutes; omitted fields keep their stored value.
   *
   * Minutes are the last stage of the lifecycle, so saving them finishes a
   * meeting waiting in `summarizing` — the status `completeRefinement` leaves
   * behind once the refined transcript is complete.
   */
  async saveMinutes(meetingId: string, input: SaveMeetingMinutesInput) {
    return this.db.transaction(async (tx) => {
      const meeting = await this.lockManageable(meetingId, tx);
      if (!meeting) return undefined;

      const values = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ) as SaveMeetingMinutesInput;

      const [minutes] = await tx
        .insert(meetingMinutes)
        .values({ ...values, meetingId })
        .onConflictDoUpdate({
          set: { ...values, updatedAt: new Date() },
          target: meetingMinutes.meetingId,
        })
        .returning();

      if (meeting.status === 'summarizing') {
        await tx
          .update(meetings)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(eq(meetings.id, meetingId));
      }

      return minutes;
    });
  }

  // ── Internals ──

  private async lockManageable(id: string, tx: Transaction): Promise<MeetingItem | undefined> {
    if (!isUuid(id)) return undefined;

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

  private async upsertSegments(
    tx: Transaction,
    meetingId: string,
    batch: AppendMeetingSegmentInput[],
  ) {
    const speakerIds = await this.ensureSpeakers(
      tx,
      meetingId,
      batch.map((segment) => segment.speakerLabel).filter((label): label is string => !!label),
    );

    const now = new Date();
    return tx
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
