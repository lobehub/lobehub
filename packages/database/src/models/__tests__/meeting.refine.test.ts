// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { meetings, meetingSegments, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MeetingModel, MeetingStateError } from '../meeting';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'meeting-refine-user';
const otherUserId = 'meeting-refine-other';
const model = new MeetingModel(serverDB, userId);

const base = {
  platform: 'web' as const,
  realtimeProvider: 'cloud' as const,
  refineProvider: 'cloud' as const,
  title: 'Refine',
};

/** A meeting that stopped recording with its audio stored. */
const finishedMeeting = async () => {
  const meeting = await model.create(base);
  await model.attachAudio(meeting.id, { localAudioPath: '/tmp/x.wav' });
  await model.finish(meeting.id, { durationMs: 90_000 });
  return meeting.id;
};

const refineRows = (meetingId: string) =>
  serverDB
    .select()
    .from(meetingSegments)
    .where(and(eq(meetingSegments.meetingId, meetingId), eq(meetingSegments.source, 'refine')))
    .orderBy(meetingSegments.seq);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MeetingModel refine', () => {
  it('replaces the refined transcript as a whole and keeps the live draft', async () => {
    const id = await finishedMeeting();
    await model.appendSegments(id, [
      { endMs: 5000, seq: 0, source: 'realtime', startMs: 0, text: 'draft' },
    ]);

    await model.startRefine(id);
    await model.completeRefine(id, [
      { endMs: 4000, seq: 0, speakerLabel: 'S1', startMs: 0, text: 'one' },
      { endMs: 8000, seq: 1, speakerLabel: 'S2', startMs: 4000, text: 'two' },
      { endMs: 9000, seq: 2, speakerLabel: 'S1', startMs: 8000, text: 'three' },
    ]);

    // A second pass with fewer segments leaves nothing of the first one behind.
    await model.startRefine(id);
    const updated = await model.completeRefine(id, [
      { endMs: 9000, seq: 0, speakerLabel: 'S1', startMs: 0, text: 'all of it' },
    ]);

    expect(updated).toMatchObject({ error: null, status: 'ready' });
    expect((await refineRows(id)).map((row) => row.text)).toEqual(['all of it']);

    const detail = await model.getDetail(id);
    expect(detail?.segmentSource).toBe('refine');
    expect(detail?.speakers.map((speaker) => speaker.label).sort()).toEqual(['S1', 'S2']);
    const draft = await model.getDetail(id, { source: 'realtime' });
    expect(draft?.segments.map((segment) => segment.text)).toEqual(['draft']);
  });

  it('records the failure code and clears it on retry', async () => {
    const id = await finishedMeeting();
    await model.startRefine(id);

    const failed = await model.failRefine(id, {
      code: 'quota_exceeded',
      message: 'InsufficientQuota',
      stage: 'refine',
    });
    expect(failed).toMatchObject({
      error: { code: 'quota_exceeded', stage: 'refine' },
      status: 'failed',
    });

    const retried = await model.startRefine(id);
    expect(retried).toMatchObject({ error: null, status: 'transcribing' });
  });

  it('refuses to refine a meeting that is still recording', async () => {
    const meeting = await model.create(base);
    await expect(model.startRefine(meeting.id)).rejects.toBeInstanceOf(MeetingStateError);

    const [row] = await serverDB.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(row.status).toBe('recording');
  });

  it('only completes a refine that is in progress', async () => {
    const id = await finishedMeeting();
    await model.startRefine(id);
    await model.completeRefine(id, []);

    await expect(model.completeRefine(id, [])).rejects.toBeInstanceOf(MeetingStateError);
  });

  it('keeps serving the draft while a re-run replaces a refined transcript', async () => {
    const id = await finishedMeeting();
    await model.appendSegments(id, [
      { endMs: 5000, seq: 0, source: 'realtime', startMs: 0, text: 'draft' },
    ]);
    await model.startRefine(id);
    await model.completeRefine(id, [{ endMs: 4000, seq: 0, startMs: 0, text: 'first pass' }]);

    await model.startRefine(id);

    expect((await model.getDetail(id))?.segmentSource).toBe('realtime');
  });

  it('falls back to the draft when a refined pass landed no segments', async () => {
    const id = await finishedMeeting();
    await model.startRefine(id);
    await model.completeRefine(id, []);

    // The meeting is refined-status but holds no refine rows, so the draft is
    // still the only transcript there is.
    expect((await model.getDetail(id))?.segmentSource).toBe('realtime');
  });

  it('only records a failure for a refine in progress', async () => {
    const meeting = await model.create(base);
    const error = { code: 'transcription_failed' as const, stage: 'refine' as const };

    await expect(model.failRefine(meeting.id, error)).rejects.toBeInstanceOf(MeetingStateError);

    const [row] = await serverDB.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(row).toMatchObject({ error: null, status: 'recording' });
  });

  it('treats a malformed id as missing', async () => {
    expect(await model.startRefine('not-a-uuid')).toBeUndefined();
    expect(await model.completeRefine('not-a-uuid', [])).toBeUndefined();
    expect(await model.failRefine('not-a-uuid', { code: 'audio_missing', stage: 'refine' })).toBe(
      undefined,
    );
  });

  it("does not touch another user's meeting", async () => {
    const id = await finishedMeeting();
    const stranger = new MeetingModel(serverDB, otherUserId);

    expect(await stranger.startRefine(id)).toBeUndefined();
    expect(await stranger.failRefine(id, { code: 'transcription_failed', stage: 'refine' })).toBe(
      undefined,
    );
  });
});
