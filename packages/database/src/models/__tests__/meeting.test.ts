// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  files,
  meetingMinutes,
  meetings,
  meetingSegments,
  meetingSpeakers,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';
import { MeetingModel, MeetingStateError } from '../meeting';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'meeting-model-user';
const otherUserId = 'meeting-model-other';
const workspaceId = 'meeting-model-ws';

const personal = new MeetingModel(serverDB, userId);
const stranger = new MeetingModel(serverDB, otherUserId);

const base = {
  platform: 'web' as const,
  realtimeProvider: 'cloud' as const,
  refineProvider: 'cloud' as const,
  title: 'Weekly sync',
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'meeting-ws' });
});

afterEach(async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('MeetingModel', () => {
  describe('create', () => {
    it('starts a personal meeting in recording status', async () => {
      const meeting = await personal.create({ ...base, language: 'zh' });

      expect(meeting.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-/);
      expect(meeting).toMatchObject({
        language: 'zh',
        status: 'recording',
        title: 'Weekly sync',
        userId,
        visibility: 'private',
        workspaceId: null,
      });
      expect(meeting.startedAt).toBeInstanceOf(Date);
    });

    it('writes the workspace scope in workspace mode', async () => {
      const meeting = await new MeetingModel(serverDB, userId, workspaceId).create(base);
      expect(meeting.workspaceId).toBe(workspaceId);
    });
  });

  describe('scope isolation', () => {
    it('hides a personal meeting from other users and from workspace mode', async () => {
      const meeting = await personal.create(base);

      expect(await stranger.findById(meeting.id)).toBeUndefined();
      expect(await stranger.list()).toEqual([]);
      expect(await new MeetingModel(serverDB, userId, workspaceId).findById(meeting.id)).toBe(
        undefined,
      );
      expect(await personal.findById(meeting.id)).toMatchObject({ id: meeting.id });
    });

    it('keeps workspace meetings out of personal mode', async () => {
      await new MeetingModel(serverDB, userId, workspaceId).create(base);
      expect(await personal.list()).toEqual([]);
    });

    it('shows private workspace meetings to their creator only, public ones to members', async () => {
      const owner = new MeetingModel(serverDB, userId, workspaceId);
      const member = new MeetingModel(serverDB, otherUserId, workspaceId);
      const priv = await owner.create({ ...base, title: 'private' });
      const pub = await owner.create({ ...base, title: 'public', visibility: 'public' });

      expect((await member.list()).map((m) => m.id)).toEqual([pub.id]);
      expect(await member.findById(priv.id)).toBeUndefined();
      expect((await owner.list()).map((m) => m.id).sort()).toEqual([priv.id, pub.id].sort());
    });

    it('lets a workspace member read a public meeting but not change it', async () => {
      const owner = new MeetingModel(serverDB, userId, workspaceId);
      const member = new MeetingModel(serverDB, otherUserId, workspaceId);
      const meeting = await owner.create({ ...base, visibility: 'public' });

      expect(await member.getDetail(meeting.id)).toMatchObject({ id: meeting.id });
      expect(await member.rename(meeting.id, 'hijacked')).toBeUndefined();
      expect(await member.delete(meeting.id)).toBeUndefined();
      expect(await member.pause(meeting.id)).toBeUndefined();
      expect(await member.finish(meeting.id)).toBeUndefined();
      expect(await member.completeRefinement(meeting.id)).toBeUndefined();
      expect(
        await member.appendSegments(meeting.id, [
          { endMs: 1, seq: 0, source: 'realtime', startMs: 0, text: 'x' },
        ]),
      ).toBeUndefined();
      expect(await member.attachAudio(meeting.id, { localAudioPath: '/tmp/a.wav' })).toBe(
        undefined,
      );
      expect(await member.saveMinutes(meeting.id, { summary: 'x' })).toBeUndefined();

      const [row] = await serverDB.select().from(meetings).where(eq(meetings.id, meeting.id));
      expect(row).toMatchObject({ status: 'recording', title: 'Weekly sync' });
    });

    it('hides the desktop-local audio path from a member reading a public meeting', async () => {
      const owner = new MeetingModel(serverDB, userId, workspaceId);
      const member = new MeetingModel(serverDB, otherUserId, workspaceId);
      const meeting = await owner.create({ ...base, platform: 'desktop', visibility: 'public' });
      await owner.attachAudio(meeting.id, { localAudioPath: '/Users/a/meetings/x.wav' });

      expect((await owner.getDetail(meeting.id))!.localAudioPath).toBe('/Users/a/meetings/x.wav');
      expect((await owner.list()).find((m) => m.id === meeting.id)!.localAudioPath).toBe(
        '/Users/a/meetings/x.wav',
      );

      expect((await member.getDetail(meeting.id))!.localAudioPath).toBeNull();
      expect((await member.list()).find((m) => m.id === meeting.id)!.localAudioPath).toBeNull();
    });
  });

  describe('malformed ids', () => {
    it('treats an id that is not a uuid as missing instead of failing the query', async () => {
      const id = 'not-a-uuid';

      expect(await personal.findById(id)).toBeUndefined();
      expect(await personal.getDetail(id)).toBeUndefined();
      expect(await personal.rename(id, 'x')).toBeUndefined();
      expect(await personal.delete(id)).toBeUndefined();
      expect(await personal.pause(id)).toBeUndefined();
      expect(await personal.appendSegments(id, [])).toBeUndefined();
      expect(await personal.renameSpeaker(id, crypto.randomUUID(), 'x')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns newest first with paging and a status filter', async () => {
      const first = await personal.create({ ...base, title: 'first' });
      const second = await personal.create({ ...base, title: 'second' });
      await serverDB
        .update(meetings)
        .set({ createdAt: new Date('2020-01-01') })
        .where(eq(meetings.id, first.id));
      await personal.pause(second.id);

      expect((await personal.list()).map((m) => m.title)).toEqual(['second', 'first']);
      expect((await personal.list({ limit: 1, offset: 1 })).map((m) => m.title)).toEqual(['first']);
      expect((await personal.list({ status: 'paused' })).map((m) => m.id)).toEqual([second.id]);
    });
  });

  describe('rename and delete', () => {
    it('renames the caller’s meeting', async () => {
      const meeting = await personal.create(base);
      expect(await personal.rename(meeting.id, 'Renamed')).toMatchObject({ title: 'Renamed' });
      expect(await stranger.rename(meeting.id, 'nope')).toBeUndefined();
    });

    it('deletes the meeting with its speakers, segments and minutes', async () => {
      const meeting = await personal.create(base);
      await personal.appendSegments(meeting.id, [
        { endMs: 900, seq: 0, source: 'realtime', speakerLabel: 'S1', startMs: 0, text: 'hi' },
      ]);
      await personal.saveMinutes(meeting.id, { summary: 'sum' });

      expect(await stranger.delete(meeting.id)).toBeUndefined();
      expect(await personal.delete(meeting.id)).toMatchObject({ id: meeting.id });

      expect(await personal.findById(meeting.id)).toBeUndefined();
      expect(
        await serverDB
          .select()
          .from(meetingSegments)
          .where(eq(meetingSegments.meetingId, meeting.id)),
      ).toEqual([]);
      expect(
        await serverDB
          .select()
          .from(meetingSpeakers)
          .where(eq(meetingSpeakers.meetingId, meeting.id)),
      ).toEqual([]);
      expect(
        await serverDB
          .select()
          .from(meetingMinutes)
          .where(eq(meetingMinutes.meetingId, meeting.id)),
      ).toEqual([]);
    });
  });

  describe('lifecycle', () => {
    it('pauses and resumes, rejecting transitions that do not apply', async () => {
      const meeting = await personal.create(base);

      await expect(personal.resume(meeting.id)).rejects.toBeInstanceOf(MeetingStateError);
      expect(await personal.pause(meeting.id)).toMatchObject({ status: 'paused' });
      await expect(personal.pause(meeting.id)).rejects.toBeInstanceOf(MeetingStateError);
      expect(await personal.resume(meeting.id)).toMatchObject({ status: 'recording' });
    });

    it('finishes into uploading without audio and records end time and duration', async () => {
      const meeting = await personal.create(base);
      const endedAt = new Date('2026-10-20T10:00:00Z');

      const finished = await personal.finish(meeting.id, { durationMs: 75_000, endedAt });

      expect(finished).toMatchObject({ durationMs: 75_000, endedAt, status: 'uploading' });
      await expect(personal.finish(meeting.id)).rejects.toBeInstanceOf(MeetingStateError);
      await expect(personal.pause(meeting.id)).rejects.toBeInstanceOf(MeetingStateError);
    });

    it('finishes a paused meeting straight into transcribing when audio is stored', async () => {
      const meeting = await personal.create({ ...base, platform: 'desktop' });
      await personal.attachAudio(meeting.id, { localAudioPath: '/Users/a/meetings/x.wav' });
      await personal.pause(meeting.id);

      expect(await personal.finish(meeting.id)).toMatchObject({ status: 'transcribing' });
    });

    it('completes the refine pass only from transcribing', async () => {
      const meeting = await personal.create({ ...base, platform: 'desktop' });

      // Refinement has not started while the recorder is still live.
      await expect(personal.completeRefinement(meeting.id)).rejects.toBeInstanceOf(
        MeetingStateError,
      );

      await personal.attachAudio(meeting.id, { localAudioPath: '/Users/a/meetings/x.wav' });
      await personal.finish(meeting.id);
      await personal.appendSegments(meeting.id, [
        { endMs: 1000, seq: 0, source: 'refine', startMs: 0, text: 'refined' },
      ]);

      expect(await personal.completeRefinement(meeting.id)).toMatchObject({
        status: 'summarizing',
      });
      await expect(personal.completeRefinement(meeting.id)).rejects.toBeInstanceOf(
        MeetingStateError,
      );
    });
  });

  describe('attachAudio', () => {
    it('links an uploaded file, advancing an uploading meeting to transcribing', async () => {
      const meeting = await personal.create(base);
      await personal.finish(meeting.id);
      const [file] = await serverDB
        .insert(files)
        .values({
          fileType: 'audio/webm',
          name: 'meeting.webm',
          size: 1024,
          source: FileSource.Meeting,
          url: 'files/meeting.webm',
          userId,
        })
        .returning();

      const updated = await personal.attachAudio(meeting.id, { audioFileId: file.id });

      expect(updated).toMatchObject({
        audioFileId: file.id,
        localAudioPath: null,
        status: 'transcribing',
      });
    });

    it('keeps a referenced audio file from unreferenced-upload cleanup', async () => {
      const meeting = await personal.create(base);
      const [file] = await serverDB
        .insert(files)
        .values({
          fileType: 'audio/webm',
          name: 'meeting.webm',
          size: 1024,
          source: FileSource.Meeting,
          url: 'files/kept.webm',
          userId,
        })
        .returning();
      await personal.attachAudio(meeting.id, { audioFileId: file.id });

      const fileModel = new FileModel(serverDB, userId);
      expect(await fileModel.deleteUnreferenced(file.id, { source: FileSource.Meeting })).toBe(
        undefined,
      );
      expect(await fileModel.findById(file.id)).toMatchObject({ id: file.id });

      await personal.delete(meeting.id);
      await fileModel.deleteUnreferenced(file.id, { source: FileSource.Meeting });
      expect(await fileModel.findById(file.id)).toBeUndefined();
    });

    it('switches to a local path and clears the uploaded file', async () => {
      const meeting = await personal.create(base);
      const updated = await personal.attachAudio(meeting.id, { localAudioPath: '/x.wav' });
      expect(updated).toMatchObject({ audioFileId: null, localAudioPath: '/x.wav' });
    });
  });

  describe('appendSegments', () => {
    it('stores segments with speakers, creating each label once', async () => {
      const meeting = await personal.create(base);

      const stored = await personal.appendSegments(meeting.id, [
        { endMs: 1500, seq: 0, source: 'realtime', speakerLabel: 'S1', startMs: 0, text: '大家好' },
        { endMs: 3200, seq: 1, source: 'realtime', speakerLabel: 'S2', startMs: 1500, text: 'Hi' },
        { endMs: 5000, seq: 2, source: 'realtime', speakerLabel: 'S1', startMs: 3200, text: 'OK' },
        { endMs: 6000, seq: 3, source: 'realtime', startMs: 5000, text: 'no speaker' },
      ]);

      expect(stored).toHaveLength(4);
      expect(stored![0].speakerId).toBe(stored![2].speakerId);
      expect(stored![0].speakerId).not.toBe(stored![1].speakerId);
      expect(stored![3].speakerId).toBeNull();

      const speakers = await serverDB
        .select()
        .from(meetingSpeakers)
        .where(eq(meetingSpeakers.meetingId, meeting.id));
      expect(speakers.map((s) => s.label).sort()).toEqual(['S1', 'S2']);

      // A later batch reuses the existing speaker row.
      const [later] = (await personal.appendSegments(meeting.id, [
        { endMs: 7000, seq: 4, source: 'realtime', speakerLabel: 'S2', startMs: 6000, text: 'x' },
      ]))!;
      expect(later.speakerId).toBe(stored![1].speakerId);
    });

    it('replaces a re-sent seq instead of duplicating text', async () => {
      const meeting = await personal.create(base);
      const segment = { endMs: 1000, seq: 0, source: 'realtime' as const, startMs: 0 };

      await personal.appendSegments(meeting.id, [{ ...segment, text: 'draft' }]);
      await personal.appendSegments(meeting.id, [{ ...segment, endMs: 1200, text: 'final' }]);
      // Duplicate keys inside one batch: the last copy wins.
      await personal.appendSegments(meeting.id, [
        { ...segment, seq: 1, startMs: 1200, endMs: 2000, text: 'a' },
        { ...segment, seq: 1, startMs: 1200, endMs: 2100, text: 'b' },
      ]);

      const rows = await serverDB
        .select()
        .from(meetingSegments)
        .where(eq(meetingSegments.meetingId, meeting.id));
      expect(rows.map((r) => [r.seq, r.text, r.endMs]).sort()).toEqual([
        [0, 'final', 1200],
        [1, 'b', 2100],
      ]);
    });

    it('keeps realtime and refine transcripts separate even with the same seq', async () => {
      const meeting = await personal.create(base);
      await personal.appendSegments(meeting.id, [
        { endMs: 1000, seq: 0, source: 'realtime', startMs: 0, text: 'draft' },
        { endMs: 1000, seq: 0, source: 'refine', speakerLabel: 'S1', startMs: 0, text: 'final' },
      ]);

      const rows = await serverDB
        .select()
        .from(meetingSegments)
        .where(eq(meetingSegments.meetingId, meeting.id));
      expect(rows).toHaveLength(2);
    });

    it('accepts an empty batch', async () => {
      const meeting = await personal.create(base);
      expect(await personal.appendSegments(meeting.id, [])).toEqual([]);
    });

    it('stores a transcript longer than a 60 s realtime session without losing segments', async () => {
      const meeting = await personal.create(base);
      // 30 minutes at one 2-second segment each, sent in batches as a recorder would.
      const all = Array.from({ length: 900 }, (_, seq) => ({
        endMs: (seq + 1) * 2000,
        seq,
        source: 'realtime' as const,
        speakerLabel: `S${(seq % 3) + 1}`,
        startMs: seq * 2000,
        text: `segment ${seq}`,
      }));
      for (let i = 0; i < all.length; i += 100) {
        await personal.appendSegments(meeting.id, all.slice(i, i + 100));
      }

      const detail = await personal.getDetail(meeting.id);
      expect(detail!.segments).toHaveLength(900);
      expect(detail!.segments.at(-1)).toMatchObject({ endMs: 1_800_000, text: 'segment 899' });
      expect(detail!.speakers).toHaveLength(3);
    });
  });

  describe('getDetail', () => {
    it('returns the realtime draft until the refine pass completes, then the refined transcript', async () => {
      const meeting = await personal.create(base);
      await personal.appendSegments(meeting.id, [
        { endMs: 2000, seq: 1, source: 'realtime', startMs: 1000, text: 'second' },
        { endMs: 1000, seq: 0, source: 'realtime', startMs: 0, text: 'first' },
      ]);

      const draft = await personal.getDetail(meeting.id);
      expect(draft).toMatchObject({ minutes: null, segmentSource: 'realtime' });
      expect(draft!.segments.map((s) => s.text)).toEqual(['first', 'second']);

      await personal.appendSegments(meeting.id, [
        { endMs: 2000, seq: 0, source: 'refine', speakerLabel: 'S1', startMs: 0, text: 'refined' },
      ]);

      // A long transcript arrives in batches, so refine segments on record do not
      // mean the pass is over: keep serving the complete draft until it is.
      const midway = await personal.getDetail(meeting.id);
      expect(midway!.segmentSource).toBe('realtime');
      expect(midway!.segments).toHaveLength(2);

      // The refine pass is over: the meeting leaves `transcribing`, so reads now
      // serve the refined transcript instead of the draft.
      await personal.finish(meeting.id);
      await personal.attachAudio(meeting.id, { localAudioPath: '/Users/a/meetings/x.wav' });
      await personal.completeRefinement(meeting.id);

      const refined = await personal.getDetail(meeting.id);
      expect(refined!.segmentSource).toBe('refine');
      expect(refined!.segments.map((s) => s.text)).toEqual(['refined']);
      expect(refined!.speakers.map((s) => s.label)).toEqual(['S1']);

      const forced = await personal.getDetail(meeting.id, { source: 'realtime' });
      expect(forced!.segments).toHaveLength(2);
    });

    it('is undefined for meetings the caller cannot read', async () => {
      const meeting = await personal.create(base);
      expect(await stranger.getDetail(meeting.id)).toBeUndefined();
    });
  });

  describe('renameSpeaker', () => {
    it('names a speaker of the caller’s meeting only', async () => {
      const meeting = await personal.create(base);
      const [segment] = (await personal.appendSegments(meeting.id, [
        { endMs: 1, seq: 0, source: 'refine', speakerLabel: 'S1', startMs: 0, text: 'x' },
      ]))!;
      const other = await personal.create(base);

      expect(await personal.renameSpeaker(meeting.id, segment.speakerId!, 'Alice')).toMatchObject({
        displayName: 'Alice',
        label: 'S1',
      });
      expect(await stranger.renameSpeaker(meeting.id, segment.speakerId!, 'Eve')).toBeUndefined();
      // A speaker id from another meeting does not match.
      expect(await personal.renameSpeaker(other.id, segment.speakerId!, 'Bob')).toBeUndefined();
      expect(await personal.renameSpeaker(meeting.id, 'not-a-uuid', 'Bob')).toBeUndefined();
    });
  });

  describe('saveMinutes', () => {
    it('creates and then patches the single minutes row', async () => {
      const meeting = await personal.create(base);
      const actionItems = [
        { id: 'a1', segmentIds: ['s1'], status: 'suggested' as const, text: 'Ship the API' },
      ];

      const created = await personal.saveMinutes(meeting.id, {
        actionItems,
        keywords: ['ASR'],
        summary: 'v1',
      });
      expect(created).toMatchObject({
        actionItems,
        chapters: [],
        keywords: ['ASR'],
        summary: 'v1',
      });

      const patched = await personal.saveMinutes(meeting.id, { summary: 'v2' });
      expect(patched).toMatchObject({ actionItems, id: created!.id, summary: 'v2' });

      const detail = await personal.getDetail(meeting.id);
      expect(detail!.minutes).toMatchObject({ summary: 'v2' });
    });

    it('marks a summarizing meeting ready once the minutes are saved', async () => {
      const meeting = await personal.create(base);
      await personal.finish(meeting.id);
      await personal.attachAudio(meeting.id, { localAudioPath: '/Users/a/meetings/x.wav' });
      await personal.completeRefinement(meeting.id);

      await personal.saveMinutes(meeting.id, { summary: 'done' });

      expect(await personal.findById(meeting.id)).toMatchObject({ status: 'ready' });
    });
  });
});
