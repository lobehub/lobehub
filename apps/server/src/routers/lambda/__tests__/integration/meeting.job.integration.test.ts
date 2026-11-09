// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { asyncTasks, files, meetings } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { AsyncTaskStatus, AsyncTaskType, FileSource } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodePcmWav } from '@/server/services/meeting/wav';

import { meetingRouter } from '../../meeting';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const recording = encodePcmWav({
  channels: 1,
  sampleRate: 16_000,
  samples: new Int16Array(4 * 16_000).map((_, i) => Math.round(Math.sin(i / 7) * 4000)),
});

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      getFileByteArray: async () => recording,
      getFullFileUrl: async (url: string) => `https://cdn/${url}`,
    };
  }),
}));

const transcribe = vi.fn();
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({ transcribe }),
}));

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return {
      generateObject: async () => ({
        actionItems: [],
        chapters: [],
        decisions: [],
        keywords: [],
        summary: 'Done.',
      }),
    };
  }),
}));

const scheduled: (() => Promise<unknown>)[] = [];
/** Run what the response scheduled; nothing runs before this, as after a real response. */
const runScheduled = async () => {
  while (scheduled.length > 0) await scheduled.shift()!();
};

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (job: () => Promise<unknown>) => {
    scheduled.push(job);
  },
}));

const handOff = vi.hoisted(() => ({ error: undefined as unknown }));
vi.mock('@/server/routers/async', () => ({
  createAsyncCaller: async ({ userId }: { userId: string }) => {
    const { runMeetingMinutesJob, runMeetingRefineJob } =
      await import('@/server/services/meeting/runJob');
    const guarded = (run: () => Promise<unknown>) => {
      if (handOff.error) throw handOff.error;
      return run();
    };
    return {
      meeting: {
        runMinutes: (input: any) => guarded(() => runMeetingMinutesJob(testDB, userId, input)),
        runRefine: (input: any) => guarded(() => runMeetingRefineJob(testDB, userId, input)),
      },
    };
  },
}));

const context = (userId: string) => ({ jwtPayload: { userId }, userId });

describe('meeting background jobs', () => {
  let ownerId: string;
  let strangerId: string;

  const tasksOf = () => testDB.select().from(asyncTasks).where(eq(asyncTasks.userId, ownerId));

  const recordedMeeting = async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'web',
      realtimeProvider: 'cloud',
      refineProvider: 'cloud',
      title: 'Sync',
    });
    const [file] = await testDB
      .insert(files)
      .values({
        fileType: 'audio/wav',
        name: 'meeting.wav',
        size: recording.byteLength,
        source: FileSource.Meeting,
        url: `meetings/${meeting!.id}.wav`,
        userId: ownerId,
      })
      .returning();
    await owner.finish({ durationMs: 4000, id: meeting!.id });
    await owner.attachAudio({ audioFileId: file.id, id: meeting!.id });
    return { id: meeting!.id, owner };
  };

  const ageTasks = () =>
    testDB
      .update(asyncTasks)
      .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(asyncTasks.userId, ownerId));

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerId = await createTestUser(testDB);
    strangerId = await createTestUser(testDB);
    scheduled.length = 0;
    handOff.error = undefined;
    transcribe.mockResolvedValue({
      duration: 4,
      segments: [{ end: 3, start: 0, text: 'hello' }],
      text: 'hello',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, ownerId);
    await cleanupTestUser(testDB, strangerId);
    vi.restoreAllMocks();
    transcribe.mockReset();
  });

  it('returns before any audio is transcribed and finishes in the background', async () => {
    const { id, owner } = await recordedMeeting();

    const started = await owner.refine({ id });

    expect(started.data).toMatchObject({ status: 'transcribing' });
    expect(transcribe).not.toHaveBeenCalled();
    expect(await tasksOf()).toMatchObject([
      {
        metadata: { meetingId: id },
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.MeetingRefine,
      },
    ]);

    await runScheduled();

    expect((await owner.detail({ id })).data).toMatchObject({
      minutes: { summary: 'Done.' },
      segmentSource: 'refine',
      status: 'ready',
    });
    expect(await tasksOf()).toMatchObject([
      { id: started.taskId, status: AsyncTaskStatus.Success },
    ]);
  });

  it('joins the job already running instead of paying for a second one', async () => {
    const { id, owner } = await recordedMeeting();

    const first = await owner.refine({ id });
    const second = await owner.refine({ id });

    expect(second.taskId).toBe(first.taskId);
    expect(await tasksOf()).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
  });

  it('leaves the meeting alone when joining a job that is still finishing', async () => {
    const { id, owner } = await recordedMeeting();
    const first = await owner.refine({ id });
    // Minutes are saved, but the job is still creating their tasks.
    await testDB.update(meetings).set({ status: 'ready' }).where(eq(meetings.id, id));
    await testDB.update(asyncTasks).set({ status: AsyncTaskStatus.Processing });

    const joined = await owner.refine({ id });

    expect(joined.taskId).toBe(first.taskId);
    expect(joined.data).toMatchObject({ status: 'ready' });
    expect((await owner.detail({ id })).data).toMatchObject({ status: 'ready' });
  });

  it('runs one job when two starts race', async () => {
    const { id, owner } = await recordedMeeting();

    const [first, second] = await Promise.all([owner.refine({ id }), owner.refine({ id })]);

    expect(second.taskId).toBe(first.taskId);
    expect(await tasksOf()).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
  });

  it('does not run a job that was already claimed', async () => {
    const { id, owner } = await recordedMeeting();
    await owner.refine({ id });
    await testDB.update(asyncTasks).set({ status: AsyncTaskStatus.Processing });

    await runScheduled();

    expect(transcribe).not.toHaveBeenCalled();
  });

  it('records a transcription failure on the meeting and the task', async () => {
    const { id, owner } = await recordedMeeting();
    transcribe.mockRejectedValue({ errorType: 'InsufficientQuota' });

    await owner.refine({ id });
    await runScheduled();

    expect((await owner.detail({ id })).data).toMatchObject({
      error: { code: 'quota_exceeded', stage: 'refine' },
      status: 'failed',
    });
    expect(await tasksOf()).toMatchObject([
      { error: { body: { detail: 'quota_exceeded' } }, status: AsyncTaskStatus.Error },
    ]);
  });

  it('closes a job whose hand-off the host refused', async () => {
    const { id, owner } = await recordedMeeting();
    handOff.error = new TRPCClientError('Loop detected', { cause: new SyntaxError('not json') });

    await owner.refine({ id });
    await runScheduled();

    expect((await owner.detail({ id })).data).toMatchObject({
      error: { code: 'transcription_failed', stage: 'refine' },
      status: 'failed',
    });
    expect(await tasksOf()).toMatchObject([{ status: AsyncTaskStatus.Error }]);
  });

  it('leaves a job open when only the response was dropped', async () => {
    const { id, owner } = await recordedMeeting();
    handOff.error = new TRPCClientError('fetch failed');

    await owner.refine({ id });
    await runScheduled();

    expect((await owner.detail({ id })).data).toMatchObject({ status: 'transcribing' });
    expect(await tasksOf()).toMatchObject([{ status: AsyncTaskStatus.Pending }]);
  });

  it('fails a job whose worker died once it is stale, and lets the user retry', async () => {
    const { id, owner } = await recordedMeeting();
    const stuck = await owner.refine({ id });
    await ageTasks();

    expect((await owner.detail({ id })).data).toMatchObject({
      error: { code: 'transcription_failed', stage: 'refine' },
      status: 'failed',
    });

    const retried = await owner.refine({ id });
    expect(retried.taskId).not.toBe(stuck.taskId);
  });

  it('starts over when a stale job is found at retry', async () => {
    const { id, owner } = await recordedMeeting();
    const stuck = await owner.refine({ id });
    await ageTasks();
    scheduled.length = 0;

    const retried = await owner.refine({ id });

    expect(retried.taskId).not.toBe(stuck.taskId);
    expect(scheduled).toHaveLength(1);
  });

  it('never expires a refine running on the device', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'desktop',
      realtimeProvider: 'local',
      refineProvider: 'local',
      title: 'Local',
    });
    const id = meeting!.id;
    await owner.attachAudio({ id, localAudioPath: '/Users/me/rec.wav' });
    await owner.finish({ durationMs: 4000, id });
    await owner.refineLocal({ id, stage: 'start' });

    expect((await owner.detail({ id })).data).toMatchObject({ status: 'transcribing' });
  });

  it('generates minutes in the background after a local refine', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'desktop',
      realtimeProvider: 'local',
      refineProvider: 'local',
      title: 'Local',
    });
    const id = meeting!.id;
    await owner.attachAudio({ id, localAudioPath: '/Users/me/rec.wav' });
    await owner.finish({ durationMs: 4000, id });
    await owner.refineLocal({ id, stage: 'start' });

    const { data } = await owner.refineLocal({
      id,
      segments: [{ endMs: 3000, startMs: 0, text: 'hello' }],
      stage: 'complete',
    });

    expect(data).toMatchObject({ status: 'summarizing' });
    await runScheduled();
    expect((await owner.detail({ id })).data).toMatchObject({
      minutes: { summary: 'Done.' },
      status: 'ready',
    });
    expect(await tasksOf()).toMatchObject([
      { status: AsyncTaskStatus.Success, type: AsyncTaskType.MeetingMinutes },
    ]);
  });

  it("creates no job for someone else's meeting", async () => {
    const { id } = await recordedMeeting();
    const stranger = meetingRouter.createCaller(context(strangerId));

    await expect(stranger.refine({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await tasksOf()).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });
});
