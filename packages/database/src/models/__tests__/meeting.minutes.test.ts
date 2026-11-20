// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MeetingModel, MeetingStateError } from '../meeting';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'meeting-minutes-user';
const otherUserId = 'meeting-minutes-other';
const model = new MeetingModel(serverDB, userId);

const item = (id: string, status: 'created' | 'suggested' = 'suggested') => ({
  id,
  segmentIds: [],
  status,
  text: `to-do ${id}`,
});

/** A meeting whose refine pass just landed and handed over to the minutes. */
const refinedMeeting = async () => {
  const meeting = await model.create({
    platform: 'web',
    realtimeProvider: 'cloud',
    refineProvider: 'cloud',
    title: 'Minutes',
  });
  await model.attachAudio(meeting.id, { localAudioPath: '/tmp/x.wav' });
  await model.finish(meeting.id, { durationMs: 60_000 });
  await model.startRefine(meeting.id);
  await model.completeRefine(
    meeting.id,
    [{ endMs: 4000, seq: 0, speakerLabel: 'S1', startMs: 0, text: 'hello' }],
    { next: 'summarizing' },
  );
  return meeting.id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MeetingModel minutes', () => {
  it('hands a refined meeting to the minutes without passing through ready', async () => {
    const id = await refinedMeeting();
    expect((await model.findById(id))!.status).toBe('summarizing');

    await model.startMinutes(id);
    const result = await model.completeMinutes(id, {
      actionItems: [item('a')],
      summary: 'Done',
    });

    expect(result!.meeting).toMatchObject({ error: null, status: 'ready' });
    expect(result!.minutes).toMatchObject({ actionItems: [item('a')], summary: 'Done' });
  });

  it('refuses minutes while the transcript is not final', async () => {
    const meeting = await model.create({
      platform: 'web',
      realtimeProvider: 'cloud',
      refineProvider: 'cloud',
      title: 'Live',
    });

    await expect(model.startMinutes(meeting.id)).rejects.toBeInstanceOf(MeetingStateError);
  });

  it('never moves a live meeting to ready', async () => {
    const meeting = await model.create({
      platform: 'web',
      realtimeProvider: 'cloud',
      refineProvider: 'cloud',
      title: 'Live',
    });

    await expect(model.completeMinutes(meeting.id, { summary: 'x' })).rejects.toBeInstanceOf(
      MeetingStateError,
    );
    await expect(
      model.failMinutes(meeting.id, { code: 'quota_exceeded', stage: 'minutes' }),
    ).rejects.toBeInstanceOf(MeetingStateError);
    expect((await model.findById(meeting.id))!.status).toBe('recording');
  });

  it('keeps the meeting ready when only the minutes failed, and clears it on retry', async () => {
    const id = await refinedMeeting();
    await model.startMinutes(id);

    const failed = await model.failMinutes(id, { code: 'quota_exceeded', stage: 'minutes' });
    expect(failed).toMatchObject({
      error: { code: 'quota_exceeded', stage: 'minutes' },
      status: 'ready',
    });

    const restarted = await model.startMinutes(id);
    expect(restarted).toMatchObject({ error: null, status: 'summarizing' });
  });

  it('updates action items under a lock, and only for the creator', async () => {
    const id = await refinedMeeting();
    await model.completeMinutes(id, { actionItems: [item('a'), item('b')] });

    const updated = await model.updateActionItems(id, (items) =>
      items.map((current) =>
        current.id === 'a' ? { ...current, status: 'created' as const, taskId: 'task_1' } : current,
      ),
    );
    expect(updated!.actionItems).toEqual([
      { ...item('a'), status: 'created', taskId: 'task_1' },
      item('b'),
    ]);

    const stranger = new MeetingModel(serverDB, otherUserId);
    expect(await stranger.updateActionItems(id, () => [])).toBeUndefined();
    expect(await stranger.startMinutes(id)).toBeUndefined();
  });

  it('has nothing to complete or fail for a meeting it cannot manage', async () => {
    const id = await refinedMeeting();
    const stranger = new MeetingModel(serverDB, otherUserId);

    expect(await stranger.completeMinutes(id, { summary: 'x' })).toBeUndefined();
    expect(
      await stranger.failMinutes(id, { code: 'quota_exceeded', stage: 'minutes' }),
    ).toBeUndefined();
    expect((await model.findById(id))!.status).toBe('summarizing');
  });

  it('has nothing to update before minutes exist', async () => {
    const id = await refinedMeeting();
    expect(await model.updateActionItems(id, (items) => items)).toBeUndefined();
  });
});
