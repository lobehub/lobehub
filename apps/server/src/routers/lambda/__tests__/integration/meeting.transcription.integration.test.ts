// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { files, meetingSegments } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { AgentRuntimeErrorType, FileSource } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
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

// 20 s of 16 kHz mono PCM: the recorder's upload format.
const recording = encodePcmWav({
  channels: 1,
  sampleRate: 16_000,
  samples: new Int16Array(20 * 16_000).map((_, i) => Math.round(Math.sin(i / 7) * 4000)),
});

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      getFileByteArray: async () => recording,
      getFullFileUrl: async (url: string) => `https://cdn.test/${url}`,
      removeUnreferencedFile: async () => {},
    };
  }),
}));

const transcribe = vi.fn();
const initModelRuntimeFromDB = vi.fn(async () => ({ transcribe }));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: (...args: unknown[]) => initModelRuntimeFromDB(...(args as [])),
}));

// Refine chains into minutes generation; covered in meeting.minutes.integration.test.ts.
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return {
      generateObject: async () => ({
        actionItems: [],
        chapters: [],
        decisions: [],
        keywords: [],
        summary: 'Weekly sync.',
      }),
    };
  }),
}));

const context = (userId: string) => ({ jwtPayload: { userId }, userId });

const diarized = {
  duration: 20,
  segments: [
    { end: 6.5, speaker: 'A', start: 0.4, text: '大家好，我们开始周会。' },
    { end: 13, speaker: 'B', start: 7, text: 'ASR streaming 已经接上了。' },
    { end: 19.6, speaker: 'A', start: 13.5, text: '好，下周上线。' },
  ],
  text: '',
};

describe('meeting transcription integration', () => {
  let ownerId: string;
  let strangerId: string;

  /** A meeting that was recorded, stopped, and has its WAV uploaded. */
  const recordedMeeting = async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'web',
      realtimeProvider: 'cloud',
      refineProvider: 'cloud',
      title: '周会',
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
    await owner.finish({ durationMs: 20_000, id: meeting!.id });
    await owner.attachAudio({ audioFileId: file.id, id: meeting!.id });
    return { id: meeting!.id, owner };
  };

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerId = await createTestUser(testDB);
    strangerId = await createTestUser(testDB);
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, ownerId);
    await cleanupTestUser(testDB, strangerId);
    vi.clearAllMocks();
  });

  it('stores a transcript refined on the desktop without the audio leaving the device', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'desktop',
      realtimeProvider: 'local',
      refineProvider: 'local',
      title: '本地周会',
    });
    const id = meeting!.id;
    await owner.attachAudio({ id, localAudioPath: '/Users/me/meetings/rec.wav' });
    await owner.finish({ durationMs: 20_000, id });

    // The server-side refine cannot reach a device-only recording.
    const { data: serverRefine } = await owner.refine({ id });
    expect(serverRefine).toMatchObject({ error: { code: 'audio_missing' }, status: 'failed' });

    const { data: started } = await owner.refineLocal({ id, stage: 'start' });
    expect(started).toMatchObject({ error: null, status: 'transcribing' });

    const { data } = await owner.refineLocal({
      id,
      segments: [
        { endMs: 6500, speakerLabel: 'speaker_1', startMs: 400, text: '大家好，我们开始周会。' },
        { endMs: 13_000, speakerLabel: 'speaker_2', startMs: 7000, text: 'ASR 已经接上了。' },
      ],
      stage: 'complete',
    });
    expect(data).toMatchObject({ audioFileId: null, status: 'ready' });
    expect(transcribe).not.toHaveBeenCalled();

    const { data: detail } = await owner.detail({ id });
    expect(detail!.segmentSource).toBe('refine');
    expect(detail!.speakers.map((speaker) => speaker.label)).toEqual(['speaker_1', 'speaker_2']);
    expect(detail!.segments.map(({ startMs, text }) => ({ startMs, text }))).toEqual([
      { startMs: 400, text: '大家好，我们开始周会。' },
      { startMs: 7000, text: 'ASR 已经接上了。' },
    ]);
    expect(detail!.minutes).toMatchObject({ summary: 'Weekly sync.' });
  });

  it('records why the desktop could not refine a local recording', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'desktop',
      realtimeProvider: 'local',
      refineProvider: 'local',
      title: '本地周会',
    });
    await owner.attachAudio({ id: meeting!.id, localAudioPath: '/tmp/rec.wav' });
    await owner.finish({ durationMs: 5000, id: meeting!.id });
    await owner.refineLocal({ id: meeting!.id, stage: 'start' });

    const { data } = await owner.refineLocal({
      code: 'transcription_failed',
      id: meeting!.id,
      message: 'model missing',
      stage: 'fail',
    });
    expect(data).toMatchObject({
      error: { code: 'transcription_failed', message: 'model missing', stage: 'refine' },
      status: 'failed',
    });

    const stranger = meetingRouter.createCaller(context(strangerId));
    await expect(stranger.refineLocal({ id: meeting!.id, stage: 'start' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refines the stored recording into a transcript with speakers and timestamps', async () => {
    transcribe.mockResolvedValue(diarized);
    const { id, owner } = await recordedMeeting();

    const { data } = await owner.refine({ id });
    expect(data).toMatchObject({ error: null, status: 'ready' });

    // Default meeting model: a diarizing OpenAI model, asked for speaker segments.
    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
      expect.anything(),
      ownerId,
      'openai',
      undefined,
    );
    expect(transcribe.mock.calls[0][0]).toMatchObject({
      chunkingStrategy: 'auto',
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
    });

    const { data: detail } = await owner.detail({ id });
    const label = new Map(detail!.speakers.map((speaker) => [speaker.id, speaker.label]));
    expect(detail!.segmentSource).toBe('refine');
    expect(
      detail!.segments.map((segment) => [
        label.get(segment.speakerId!),
        segment.startMs,
        segment.endMs,
        segment.text,
      ]),
    ).toEqual([
      ['S1', 400, 6500, '大家好，我们开始周会。'],
      ['S2', 7000, 13_000, 'ASR streaming 已经接上了。'],
      ['S1', 13_500, 19_600, '好，下周上线。'],
    ]);
  });

  it('marks a refine without provider credentials as provider_not_configured and recovers on retry', async () => {
    transcribe.mockRejectedValueOnce({
      error: { message: 'Incorrect API key provided' },
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
    });
    const { id, owner } = await recordedMeeting();

    const { data: failed } = await owner.refine({ id });
    expect(failed).toMatchObject({
      error: { code: 'provider_not_configured', stage: 'refine' },
      status: 'failed',
    });
    // The failure survives a reload, so the page can explain it later.
    expect((await owner.detail({ id })).data).toMatchObject({
      error: { code: 'provider_not_configured' },
      status: 'failed',
    });

    transcribe.mockResolvedValueOnce(diarized);
    const { data: retried } = await owner.refine({ id });
    expect(retried).toMatchObject({ error: null, status: 'ready' });
  });

  it('marks exhausted quota as quota_exceeded', async () => {
    transcribe.mockRejectedValueOnce({ errorType: AgentRuntimeErrorType.InsufficientQuota });
    const { id, owner } = await recordedMeeting();

    const { data } = await owner.refine({ id });
    expect(data).toMatchObject({ error: { code: 'quota_exceeded' }, status: 'failed' });
  });

  it("does not refine someone else's meeting", async () => {
    const { id } = await recordedMeeting();
    const stranger = meetingRouter.createCaller(context(strangerId));

    await expect(stranger.refine({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transcribe).not.toHaveBeenCalled();
  });

  describe('transcribeLive', () => {
    const window = (seq: number) => ({
      audioBase64: Buffer.from(recording.subarray(0, 44 + 16_000 * 2 * 5)).toString('base64'),
      endMs: (seq + 1) * 5000,
      startMs: seq * 5000,
      seq,
    });

    it('stores a window as realtime segment seq, and a retried window replaces it', async () => {
      transcribe.mockResolvedValue({ text: ' 第一段 ' });
      const { id, owner } = await recordedMeeting();

      await owner.transcribeLive({ ...window(0), meetingId: id });
      transcribe.mockResolvedValue({ text: '第一段（重试）' });
      const { data } = await owner.transcribeLive({ ...window(0), meetingId: id });
      expect(data).toMatchObject({ seq: 0, source: 'realtime', text: '第一段（重试）' });

      const rows = await testDB
        .select()
        .from(meetingSegments)
        .where(and(eq(meetingSegments.meetingId, id), eq(meetingSegments.source, 'realtime')));
      expect(rows).toHaveLength(1);
      expect(transcribe.mock.calls[0][0]).toMatchObject({ responseFormat: 'json' });
    });

    it('returns the meeting error code so the recorder can show the fix', async () => {
      const { id, owner } = await recordedMeeting();

      transcribe.mockRejectedValueOnce({ errorType: AgentRuntimeErrorType.InsufficientQuota });
      await expect(owner.transcribeLive({ ...window(0), meetingId: id })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'quota_exceeded',
      });

      transcribe.mockRejectedValueOnce({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
      await expect(owner.transcribeLive({ ...window(1), meetingId: id })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'provider_not_configured',
      });
    });
  });
});
