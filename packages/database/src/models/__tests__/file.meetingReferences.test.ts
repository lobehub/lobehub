// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, meetings, messages, messagesFiles, sessions, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-meeting-refs-user';
const sessionId = 'file-meeting-refs-session';
const topicId = 'file-meeting-refs-topic';
const fileModel = new FileModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(sessions).values({ id: sessionId, userId });
  await serverDB.insert(topics).values({ id: topicId, sessionId, userId });
  await serverDB.insert(messages).values({
    id: 'file-meeting-refs-msg',
    role: 'user',
    topicId,
    userId,
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

const createFile = async (name: string) => {
  const { id } = await fileModel.create({
    fileType: 'audio/wav',
    name,
    size: 1,
    url: `files/${name}`,
  });
  return id;
};

/** Records a meeting whose recording is the given upload. */
const recordWithAudio = async (audioFileId: string) => {
  await serverDB.insert(meetings).values({
    audioFileId,
    platform: 'web',
    realtimeProvider: 'cloud',
    refineProvider: 'cloud',
    title: 'Weekly sync',
    userId,
  });
};

describe('FileModel meeting audio references', () => {
  it('findDeletableFilesByTopicId keeps a file that a meeting uses as its recording', async () => {
    const [onlyInTopic, alsoRecorded] = [
      await createFile('topic.wav'),
      await createFile('meeting.wav'),
    ];
    await serverDB.insert(messagesFiles).values([
      { fileId: onlyInTopic, messageId: 'file-meeting-refs-msg', userId },
      { fileId: alsoRecorded, messageId: 'file-meeting-refs-msg', userId },
    ]);
    // Purging the topic must not take the recording away from the meeting that
    // still exists: `audio_file_id` cascades to NULL on delete.
    await recordWithAudio(alsoRecorded);

    await expect(fileModel.findDeletableFilesByTopicId(topicId)).resolves.toEqual([onlyInTopic]);
  });

  it('deleteUnreferenced keeps the recording of a meeting', async () => {
    const id = await createFile('kept.wav');
    await recordWithAudio(id);

    await expect(fileModel.deleteUnreferenced(id)).resolves.toBeUndefined();
    await expect(serverDB.select().from(files).where(eq(files.id, id))).resolves.toHaveLength(1);
  });

  it('findMeetingAudio reads a meeting recording through its creator only', async () => {
    const [recording] = await serverDB
      .insert(files)
      .values({
        fileType: 'audio/wav',
        name: 'recording.wav',
        size: 1,
        source: FileSource.Meeting,
        url: 'files/recording.wav',
        userId,
      })
      .returning();
    await recordWithAudio(recording.id);

    await expect(fileModel.findMeetingAudio(recording.id, userId)).resolves.toMatchObject({
      id: recording.id,
    });
    // Another member may listen through a public meeting, but never open the
    // upload as if it were their own.
    await expect(
      fileModel.findMeetingAudio(recording.id, 'file-meeting-refs-other'),
    ).resolves.toBeUndefined();
  });

  it('findMeetingAudio leaves an ordinary upload alone', async () => {
    const id = await createFile('note.wav');
    await recordWithAudio(id);

    await expect(fileModel.findMeetingAudio(id, userId)).resolves.toBeUndefined();
  });
});
