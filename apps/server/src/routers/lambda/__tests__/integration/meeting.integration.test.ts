// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { files, meetings, meetingSegments, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { meetingRouter } from '../../meeting';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const removeUnreferencedFile = vi.fn(async () => {});
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      getFullFileUrl: async (url: string) => `https://cdn.test/${url}`,
      removeUnreferencedFile,
    };
  }),
}));

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

const startInput = {
  platform: 'web' as const,
  realtimeProvider: 'cloud' as const,
  refineProvider: 'cloud' as const,
  title: '周会',
};

describe('meeting router integration', () => {
  let ownerId: string;
  let strangerId: string;
  const workspaceId = 'meeting-router-ws';

  const seedAudio = async (
    userId: string,
    fileType = 'audio/webm',
    ws?: string,
    visibility: 'private' | 'public' = 'public',
  ) => {
    const [file] = await testDB
      .insert(files)
      .values({
        fileType,
        name: 'meeting.webm',
        size: 2048,
        source: FileSource.Meeting,
        url: `meetings/${Math.random()}.webm`,
        userId,
        visibility,
        workspaceId: ws,
      })
      .returning();
    return file;
  };

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerId = await createTestUser(testDB);
    strangerId = await createTestUser(testDB);
    await testDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'WS', primaryOwnerId: ownerId, slug: 'meeting-router-ws' });
  });

  afterEach(async () => {
    await testDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await cleanupTestUser(testDB, ownerId);
    await cleanupTestUser(testDB, strangerId);
    vi.clearAllMocks();
  });

  it('runs a meeting end to end: create → segments → pause/resume → finish → audio → detail → rename → delete', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));

    const { data: meeting } = (await owner.create({ ...startInput, language: 'zh' }))!;
    expect(meeting).toMatchObject({ status: 'recording', title: '周会' });

    // A 75 s recording: more than one 60 s realtime session's worth of segments.
    const realtime = Array.from({ length: 15 }, (_, seq) => ({
      endMs: (seq + 1) * 5000,
      seq,
      source: 'realtime' as const,
      startMs: seq * 5000,
      text: `第 ${seq} 句`,
    }));
    await owner.appendSegments({ meetingId: meeting.id, segments: realtime.slice(0, 10) });
    expect((await owner.pause({ id: meeting.id }))!.data.status).toBe('paused');
    expect((await owner.resume({ id: meeting.id }))!.data.status).toBe('recording');
    // A retried batch overlapping the previous one must not duplicate text.
    await owner.appendSegments({ meetingId: meeting.id, segments: realtime.slice(8) });

    const { data: finished } = (await owner.finish({ durationMs: 75_000, id: meeting.id }))!;
    expect(finished).toMatchObject({ durationMs: 75_000, status: 'uploading' });

    const audio = await seedAudio(ownerId);
    const { data: attached } = (await owner.attachAudio({
      audioFileId: audio.id,
      id: meeting.id,
    }))!;
    expect(attached).toMatchObject({ audioFileId: audio.id, status: 'transcribing' });

    await owner.appendSegments({
      meetingId: meeting.id,
      segments: [
        { endMs: 40_000, seq: 0, source: 'refine', speakerLabel: 'S1', startMs: 0, text: 'A' },
        { endMs: 75_000, seq: 1, source: 'refine', speakerLabel: 'S2', startMs: 40_000, text: 'B' },
      ],
    });

    // Refine batches land while the pass is still running: the complete draft wins.
    const { data: midway } = (await owner.detail({ id: meeting.id }))!;
    expect(midway.segmentSource).toBe('realtime');

    // The refine pass is over: the meeting leaves `transcribing` through the API,
    // so reads switch to the refined transcript without touching the row directly.
    const { data: completed } = (await owner.completeRefinement({ id: meeting.id }))!;
    expect(completed.status).toBe('summarizing');

    const { data: detail } = (await owner.detail({ id: meeting.id }))!;
    expect(detail.segmentSource).toBe('refine');
    expect(detail.segments.map((s) => [s.text, s.startMs, s.endMs])).toEqual([
      ['A', 0, 40_000],
      ['B', 40_000, 75_000],
    ]);
    expect(detail.speakers.map((s) => s.label)).toEqual(['S1', 'S2']);
    expect(detail.audio).toMatchObject({
      fileType: 'audio/webm',
      id: audio.id,
      url: `https://cdn.test/${audio.url}`,
    });

    const { data: draft } = (await owner.detail({ id: meeting.id, source: 'realtime' }))!;
    expect(draft.segments).toHaveLength(15);
    expect(draft.segments.map((s) => s.seq)).toEqual(realtime.map((s) => s.seq));

    expect((await owner.rename({ id: meeting.id, title: '产品周会' }))!.data.title).toBe(
      '产品周会',
    );
    expect((await owner.list())!.data.map((m) => m.title)).toEqual(['产品周会']);

    await owner.delete({ id: meeting.id });
    expect(removeUnreferencedFile).toHaveBeenCalledWith(audio.id, FileSource.Meeting);
    await expect(owner.detail({ id: meeting.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await testDB.select().from(meetingSegments).where(eq(meetingSegments.meetingId, meeting.id)),
    ).toEqual([]);
  });

  it('isolates meetings across users and between personal and workspace scope', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const ownerInWs = meetingRouter.createCaller(context(ownerId, workspaceId));
    const stranger = meetingRouter.createCaller(context(strangerId));
    const memberInWs = meetingRouter.createCaller(context(strangerId, workspaceId));

    const { data: personal } = (await owner.create(startInput))!;
    const { data: wsPrivate } = (await ownerInWs.create(startInput))!;
    const { data: wsPublic } = (await ownerInWs.create({ ...startInput, visibility: 'public' }))!;

    expect(wsPrivate.workspaceId).toBe(workspaceId);
    expect((await owner.list())!.data.map((m) => m.id)).toEqual([personal.id]);
    expect((await stranger.list())!.data).toEqual([]);
    expect((await memberInWs.list())!.data.map((m) => m.id)).toEqual([wsPublic.id]);

    await expect(stranger.detail({ id: personal.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(ownerInWs.detail({ id: personal.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(memberInWs.detail({ id: wsPrivate.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await memberInWs.detail({ id: wsPublic.id }))!.data.id).toBe(wsPublic.id);

    // Readable is not writable: only the creator changes a meeting.
    const writes = [
      () => memberInWs.rename({ id: wsPublic.id, title: 'x' }),
      () => memberInWs.delete({ id: wsPublic.id }),
      () => memberInWs.pause({ id: wsPublic.id }),
      () => memberInWs.finish({ id: wsPublic.id }),
      () => memberInWs.completeRefinement({ id: wsPublic.id }),
      () => memberInWs.saveMinutes({ meetingId: wsPublic.id, summary: 'x' }),
      () =>
        memberInWs.appendSegments({
          meetingId: wsPublic.id,
          segments: [{ endMs: 1, seq: 0, source: 'realtime', startMs: 0, text: 'x' }],
        }),
      () => stranger.rename({ id: personal.id, title: 'x' }),
      () => stranger.delete({ id: personal.id }),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }

    const [row] = await testDB.select().from(meetings).where(eq(meetings.id, wsPublic.id));
    expect(row).toMatchObject({ status: 'recording', title: '周会' });
  });

  it('shares a meeting-owned recording with readers of a public meeting', async () => {
    const ownerInWs = meetingRouter.createCaller(context(ownerId, workspaceId));
    const memberInWs = meetingRouter.createCaller(context(strangerId, workspaceId));

    const { data: meeting } = (await ownerInWs.create({ ...startInput, visibility: 'public' }))!;
    const audio = await seedAudio(ownerId, 'audio/webm', workspaceId, 'private');
    await ownerInWs.attachAudio({ audioFileId: audio.id, id: meeting.id });

    // The upload stays private to the creator; the meeting is what shares it.
    expect((await memberInWs.detail({ id: meeting.id }))!.data.audio).toMatchObject({
      fileType: 'audio/webm',
      id: audio.id,
      url: `https://cdn.test/${audio.url}`,
    });

    // A private library upload attached to the same meeting is not shared with it.
    const [library] = await testDB
      .insert(files)
      .values({
        fileType: 'audio/mpeg',
        name: 'library.mp3',
        size: 1024,
        url: 'library.mp3',
        userId: ownerId,
        visibility: 'private',
        workspaceId,
      })
      .returning();

    await ownerInWs.attachAudio({ audioFileId: library.id, id: meeting.id });
    expect((await ownerInWs.detail({ id: meeting.id }))!.data.audio).toMatchObject({
      id: library.id,
    });
    expect((await memberInWs.detail({ id: meeting.id }))!.data.audio).toBeNull();
  });

  it('only attaches an audio file the caller can read', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = (await owner.create(startInput))!;

    const foreign = await seedAudio(strangerId);
    await expect(
      owner.attachAudio({ audioFileId: foreign.id, id: meeting.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const pdf = await seedAudio(ownerId, 'application/pdf');
    await expect(owner.attachAudio({ audioFileId: pdf.id, id: meeting.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // Desktop local mode stores a device path and nothing is uploaded.
    const { data } = (await owner.attachAudio({
      id: meeting.id,
      localAudioPath: '/Users/me/meetings/a.wav',
    }))!;
    expect(data).toMatchObject({ audioFileId: null, localAudioPath: '/Users/me/meetings/a.wav' });
  });

  it('reclaims the upload a meeting no longer points at', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = (await owner.create(startInput))!;
    const first = await seedAudio(ownerId);
    const second = await seedAudio(ownerId);

    await owner.attachAudio({ audioFileId: first.id, id: meeting.id });
    expect(removeUnreferencedFile).not.toHaveBeenCalled();

    await owner.attachAudio({ audioFileId: second.id, id: meeting.id });
    expect(removeUnreferencedFile).toHaveBeenCalledWith(first.id, FileSource.Meeting);

    // Switching to desktop-local audio displaces the upload as well.
    await owner.attachAudio({ id: meeting.id, localAudioPath: '/Users/me/meetings/a.wav' });
    expect(removeUnreferencedFile).toHaveBeenLastCalledWith(second.id, FileSource.Meeting);
    expect(removeUnreferencedFile).toHaveBeenCalledTimes(2);
  });

  it('maps lifecycle violations to CONFLICT and rejects malformed segments', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = (await owner.create(startInput))!;

    await expect(owner.resume({ id: meeting.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await owner.finish({ id: meeting.id });
    await expect(owner.finish({ id: meeting.id })).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      owner.appendSegments({
        meetingId: meeting.id,
        segments: [{ endMs: 100, seq: 0, source: 'realtime', startMs: 200, text: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('saves minutes and renames speakers', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = (await owner.create(startInput))!;
    const { data: segments } = (await owner.appendSegments({
      meetingId: meeting.id,
      segments: [
        { endMs: 3000, seq: 0, source: 'refine', speakerLabel: 'S1', startMs: 0, text: '我来写' },
      ],
    }))!;

    await owner.saveMinutes({
      actionItems: [
        {
          assigneeHint: '我',
          id: 'a1',
          segmentIds: [segments[0].id],
          speakerLabel: 'S1',
          status: 'suggested',
          text: '写会议 API',
        },
      ],
      decisions: [{ segmentIds: [segments[0].id], text: '先做 MVP' }],
      meetingId: meeting.id,
      summary: '讨论会议纪要',
    });
    await owner.renameSpeaker({
      displayName: 'Alice',
      meetingId: meeting.id,
      speakerId: segments[0].speakerId!,
    });

    const { data: detail } = (await owner.detail({ id: meeting.id }))!;
    expect(detail.minutes).toMatchObject({
      actionItems: [{ id: 'a1', status: 'suggested', text: '写会议 API' }],
      decisions: [{ text: '先做 MVP' }],
      summary: '讨论会议纪要',
    });
    expect(detail.speakers[0]).toMatchObject({ displayName: 'Alice', label: 'S1' });

    await expect(
      owner.saveMinutes({ documentId: 'docs_missing', meetingId: meeting.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
