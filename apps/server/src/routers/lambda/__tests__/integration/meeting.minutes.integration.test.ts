// @vitest-environment node
import { DEFAULT_SYSTEM_AGENT_CONFIG, TRACING_SCENARIOS } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, files, notifications, tasks, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { MEETING_MINUTES_PROMPT_VERSION } from '@lobechat/prompts';
import { AgentRuntimeErrorType, FileSource } from '@lobechat/types';
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
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(async () => ({ transcribe })),
}));

const generateObject = vi.fn();
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return { generateObject };
  }),
}));

const context = (userId: string) => ({ jwtPayload: { userId }, userId });

const diarized = {
  duration: 20,
  segments: [
    { end: 6.5, speaker: 'A', start: 0.4, text: '大家好，我们开始周会，先过上线计划。' },
    { end: 13, speaker: 'B', start: 7, text: '决定下周三发布 beta，我来写发布说明。' },
    { end: 19.6, speaker: 'A', start: 13.5, text: '竞品调研交给 Research Agent，周五前给结论。' },
  ],
  text: '',
};

/** What the model returns for `diarized`: cites lines by index, names owners as spoken. */
const generated = {
  actionItems: [
    {
      assignee: 'Bob Wang',
      dueDate: '2026-10-28',
      segmentIndexes: [1],
      text: '写 beta 发布说明',
    },
    {
      assignee: 'Research Agent',
      dueDate: '2026-10-23',
      segmentIndexes: [2],
      text: '完成竞品调研并给出结论',
    },
    { assignee: '', dueDate: '', segmentIndexes: [7], text: '整理会议录音' },
  ],
  chapters: [
    { endIndex: 0, startIndex: 0, title: '开场' },
    { endIndex: 2, startIndex: 1, title: '上线计划' },
  ],
  decisions: [{ segmentIndexes: [1], text: '下周三发布 beta' }],
  keywords: ['beta', '竞品调研'],
  summary: '周会确认了 beta 的上线时间，并分配了发布说明和竞品调研。',
};

describe('meeting minutes integration', () => {
  let ownerId: string;
  let strangerId: string;
  let agentId: string;

  /** Record, stop and upload a meeting, then run the refine pass (which writes the minutes). */
  const refinedMeeting = async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data: meeting } = await owner.create({
      platform: 'web',
      realtimeProvider: 'cloud',
      refineProvider: 'cloud',
      startedAt: new Date('2026-10-20T02:00:00Z'),
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
    const { data } = await owner.refine({ id: meeting!.id });
    return { id: meeting!.id, owner, refined: data };
  };

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerId = await createTestUser(testDB);
    strangerId = await createTestUser(testDB);
    await testDB.update(users).set({ fullName: 'Bob Wang' }).where(eq(users.id, ownerId));
    agentId = `agt_${ownerId.slice(0, 8)}`;
    await testDB
      .insert(agents)
      .values({ id: agentId, slug: agentId, title: 'Research Agent', userId: ownerId });
    transcribe.mockResolvedValue(diarized);
    generateObject.mockResolvedValue(generated);
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, ownerId);
    await cleanupTestUser(testDB, strangerId);
    vi.clearAllMocks();
  });

  it('writes the minutes right after the refine pass, citing the transcript', async () => {
    const { id, owner, refined } = await refinedMeeting();
    expect(refined).toMatchObject({ error: null, status: 'ready' });

    // One structured generation, traced under its own scenario, prompt version and schema.
    expect(generateObject).toHaveBeenCalledTimes(1);
    const [payload, options] = generateObject.mock.calls[0];
    expect(payload.schema.name).toBe('meeting_minutes');
    expect(options).toMatchObject({
      metadata: { trigger: 'meeting_minutes' },
      tracing: {
        promptVersion: MEETING_MINUTES_PROMPT_VERSION,
        scenario: TRACING_SCENARIOS.MeetingMinutes,
        schemaName: 'meeting_minutes',
      },
    });
    const prompt = payload.messages[1].content as string;
    expect(prompt).toContain('Date: 2026-10-20 (Tuesday)');
    expect(prompt).toContain('- Bob Wang');
    expect(prompt).toContain('- Research Agent');
    expect(prompt).toContain('[#1 00:07 S2] 决定下周三发布 beta，我来写发布说明。');

    const { data: detail } = await owner.detail({ id });
    const segmentId = (index: number) => detail!.segments[index].id;
    const { minutes } = detail!;

    expect(minutes!.summary).toBe(generated.summary);
    expect(minutes!.keywords).toEqual(['beta', '竞品调研']);
    expect(minutes!.chapters).toEqual([
      { endMs: 6500, segmentIds: [segmentId(0)], startMs: 400, title: '开场' },
      {
        endMs: 19_600,
        segmentIds: [segmentId(1), segmentId(2)],
        startMs: 7000,
        title: '上线计划',
      },
    ]);
    expect(minutes!.decisions).toEqual([{ segmentIds: [segmentId(1)], text: '下周三发布 beta' }]);
    expect(minutes!.actionItems).toEqual([
      expect.objectContaining({
        assignee: { id: ownerId, name: 'Bob Wang', type: 'user' },
        dueDate: '2026-10-28',
        segmentIds: [segmentId(1)],
        startMs: 7000,
        status: 'suggested',
        text: '写 beta 发布说明',
      }),
      expect.objectContaining({
        assignee: { id: agentId, name: 'Research Agent', type: 'agent' },
        dueDate: '2026-10-23',
        segmentIds: [segmentId(2)],
        startMs: 13_500,
        status: 'suggested',
      }),
      // Nobody took it and its citation was out of range: unassigned and uncited, not guessed.
      expect.objectContaining({ segmentIds: [], status: 'suggested', text: '整理会议录音' }),
    ]);
    expect(minutes!.actionItems[2].assignee).toBeUndefined();
    const { model, provider } = DEFAULT_SYSTEM_AGENT_CONFIG.meetingMinutes;
    expect(minutes!.model).toBe(`${provider}/${model}`);
  });

  it('turns confirmed items into tasks, links them back and notifies the recorder', async () => {
    const { id, owner } = await refinedMeeting();
    const { data: detail } = await owner.detail({ id });
    const [release, research, recording_] = detail!.minutes!.actionItems;

    const { data } = await owner.createTasks({
      items: [
        // Edited in the confirmation list: reworded, deadline moved.
        {
          assignee: { id: ownerId, type: 'user' },
          dueDate: '2026-10-27',
          id: release.id,
          text: '写 beta 发布说明（含升级指南）',
        },
        {
          assignee: { id: agentId, type: 'agent' },
          dueDate: '2026-10-23',
          id: research.id,
          text: research.text,
        },
      ],
      meetingId: id,
    });

    expect(data!.failed).toEqual([]);
    expect(data!.created).toHaveLength(2);

    const rows = await testDB.select().from(tasks).where(eq(tasks.createdByUserId, ownerId));
    const byName = new Map(rows.map((row) => [row.name, row]));
    const releaseTask = byName.get('写 beta 发布说明（含升级指南）')!;
    expect(releaseTask.assigneeUserId).toBe(ownerId);
    expect(releaseTask.instruction).toContain('Due: 2026-10-27');
    expect(releaseTask.instruction).toContain(`From meeting [周会](/meeting/${id}) at 00:07.`);
    expect(releaseTask.instruction).toContain('> 决定下周三发布 beta，我来写发布说明。');
    expect(byName.get('完成竞品调研并给出结论')!.assigneeAgentId).toBe(agentId);

    const { data: after } = await owner.detail({ id });
    const items = new Map(after!.minutes!.actionItems.map((item) => [item.id, item]));
    expect(items.get(release.id)).toMatchObject({
      dueDate: '2026-10-27',
      status: 'created',
      taskId: releaseTask.id,
      taskIdentifier: releaseTask.identifier,
      text: '写 beta 发布说明（含升级指南）',
    });
    expect(items.get(research.id)).toMatchObject({ status: 'created' });
    expect(items.get(recording_.id)).toMatchObject({ status: 'suggested' });

    const inbox = await testDB
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ownerId));
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      actionUrl: `/meeting/${id}`,
      category: 'meeting',
      title: '2 tasks created from "周会"',
      type: 'meeting_tasks_created',
    });
    expect(inbox[0].content.split('\n')[0]).toBe('2 tasks created from "周会":');
    expect(inbox[0].content).toContain(
      `${releaseTask.identifier} 写 beta 发布说明（含升级指南） → Bob Wang (due 2026-10-27)`,
    );

    // Confirming again never duplicates a task that already exists.
    const { data: again } = await owner.createTasks({
      items: [{ id: release.id, text: release.text }],
      meetingId: id,
    });
    expect(again!.created).toEqual([]);
    expect(
      await testDB.select().from(tasks).where(eq(tasks.createdByUserId, ownerId)),
    ).toHaveLength(2);
  });

  it('creates the tasks without confirmation when auto-create is on', async () => {
    await testDB
      .update(users)
      .set({ preference: { meeting: { autoCreateTasks: true } } })
      .where(eq(users.id, ownerId));

    const { id, owner } = await refinedMeeting();

    const { data: detail } = await owner.detail({ id });
    expect(detail!.minutes!.actionItems.map((item) => item.status)).toEqual([
      'created',
      'created',
      'created',
    ]);
    expect(
      await testDB.select().from(tasks).where(eq(tasks.createdByUserId, ownerId)),
    ).toHaveLength(3);
  });

  it('keeps created tasks linked when the minutes are regenerated', async () => {
    const { id, owner } = await refinedMeeting();
    const { data: detail } = await owner.detail({ id });
    const [release] = detail!.minutes!.actionItems;
    await owner.createTasks({ items: [{ id: release.id, text: release.text }], meetingId: id });

    const { data } = await owner.generateMinutes({ id });
    expect(data).toMatchObject({ error: null, status: 'ready' });

    const { data: after } = await owner.detail({ id });
    const items = after!.minutes!.actionItems;
    expect(items.filter((item) => item.status === 'created').map((item) => item.id)).toEqual([
      release.id,
    ]);
    // The regenerated release to-do cites the same passage as the created one: not suggested twice.
    expect(items.filter((item) => item.status === 'suggested').map((item) => item.text)).toEqual([
      '完成竞品调研并给出结论',
      '整理会议录音',
    ]);
  });

  it('keeps the transcript ready and records the failure when minutes generation fails', async () => {
    generateObject.mockRejectedValueOnce({ errorType: AgentRuntimeErrorType.InsufficientQuota });
    const { id, owner, refined } = await refinedMeeting();

    expect(refined).toMatchObject({
      error: { code: 'quota_exceeded', stage: 'minutes' },
      status: 'ready',
    });
    expect((await owner.detail({ id })).data!.minutes).toBeNull();

    // Output that does not match the schema is rejected rather than stored.
    generateObject.mockResolvedValueOnce({ summary: '' });
    expect((await owner.generateMinutes({ id })).data).toMatchObject({
      error: { code: 'summarization_failed', stage: 'minutes' },
    });

    const { data: retried } = await owner.generateMinutes({ id });
    expect(retried).toMatchObject({ error: null, status: 'ready' });
    expect((await owner.detail({ id })).data!.minutes!.summary).toBe(generated.summary);
  });

  it('assigns the to-dos of a speaker once that speaker is named after a member or agent', async () => {
    generateObject.mockResolvedValue({
      ...generated,
      actionItems: [
        { assignee: 'S3', dueDate: '', segmentIndexes: [2], text: '完成竞品调研' },
        { assignee: 'S1', dueDate: '', segmentIndexes: [0], text: '整理议程' },
      ],
    });
    const { id, owner } = await refinedMeeting();
    const { data: detail } = await owner.detail({ id });
    expect(detail!.minutes!.actionItems.every((item) => !item.assignee)).toBe(true);

    const speaker = detail!.speakers.find((row) => row.label === 'S1')!;
    await owner.renameSpeaker({
      displayName: 'Research Agent',
      meetingId: id,
      speakerId: speaker.id,
    });

    const { data: after } = await owner.detail({ id });
    const [s3Item, s1Item] = after!.minutes!.actionItems;
    expect(s1Item.assignee).toEqual({ id: agentId, name: 'Research Agent', type: 'agent' });
    // Another speaker's to-do is untouched.
    expect(s3Item.assignee).toBeUndefined();
  });

  it('rejects an assignee that is not a member or visible agent', async () => {
    const { id, owner } = await refinedMeeting();
    const { data: detail } = await owner.detail({ id });
    const [release] = detail!.minutes!.actionItems;

    const { data } = await owner.createTasks({
      items: [{ assignee: { id: strangerId, type: 'user' }, id: release.id, text: release.text }],
      meetingId: id,
    });
    expect(data!.created).toEqual([]);
    expect(data!.failed).toEqual([{ itemId: release.id, message: 'Assignee is not available' }]);
  });

  it("does not expose someone else's meeting", async () => {
    const { id } = await refinedMeeting();
    const stranger = meetingRouter.createCaller(context(strangerId));

    await expect(stranger.generateMinutes({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      stranger.createTasks({ items: [{ id: 'x', text: 'x' }], meetingId: id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists the members and agents a to-do can go to', async () => {
    const owner = meetingRouter.createCaller(context(ownerId));
    const { data } = await owner.assigneeCandidates();

    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ownerId, name: 'Bob Wang', type: 'user' }),
        expect.objectContaining({ id: agentId, name: 'Research Agent', type: 'agent' }),
      ]),
    );
  });
});
