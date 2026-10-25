// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ChannelRepository } from '../../repositories/channel';
import { channels, files, messages, messagesFiles, sessions, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-channel-refs-user';
const fileModel = new FileModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(channels).where(eq(channels.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

const createFile = async (name: string) => {
  const { id } = await fileModel.create({
    fileType: 'text/plain',
    name,
    size: 1,
    url: `files/${name}`,
  });
  return id;
};

/** Attaches the file to a message in the user's personal channel. */
const attachInChannel = async (fileId: string) => {
  const model = new ChannelRepository(serverDB, userId);
  const { channel } = await model.create({ title: 'Channel' });
  await model.send(channel.id, {
    content: 'See attached',
    fileIds: [fileId],
    requestKey: 'req-1',
    routing: 'fallback',
  });
};

describe('FileModel channel message references', () => {
  it('deleteUnreferenced keeps a file attached to a channel message', async () => {
    // Channel attachments have their own relation; cleanup must still protect the file.
    const id = await createFile('channel.txt');
    await attachInChannel(id);

    await expect(fileModel.deleteUnreferenced(id)).resolves.toBeUndefined();
    await expect(serverDB.select().from(files).where(eq(files.id, id))).resolves.toHaveLength(1);
  });

  it('findDeletableFilesByTopicId keeps a topic file that a channel message also uses', async () => {
    const [onlyInTopic, alsoInChannel] = [
      await createFile('topic.txt'),
      await createFile('shared.txt'),
    ];
    await serverDB.insert(sessions).values({ id: 'file-channel-refs-session', userId });
    await serverDB
      .insert(topics)
      .values({ id: 'file-channel-refs-topic', sessionId: 'file-channel-refs-session', userId });
    await serverDB.insert(messages).values({
      id: 'file-channel-refs-msg',
      role: 'user',
      topicId: 'file-channel-refs-topic',
      userId,
    });
    await serverDB.insert(messagesFiles).values([
      { fileId: onlyInTopic, messageId: 'file-channel-refs-msg', userId },
      { fileId: alsoInChannel, messageId: 'file-channel-refs-msg', userId },
    ]);
    await attachInChannel(alsoInChannel);

    await expect(fileModel.findDeletableFilesByTopicId('file-channel-refs-topic')).resolves.toEqual(
      [onlyInTopic],
    );
    await serverDB.delete(topics).where(eq(topics.id, 'file-channel-refs-topic'));
    await fileModel.deleteUnreferenced(alsoInChannel);
    expect(await serverDB.select().from(files).where(eq(files.id, alsoInChannel))).toHaveLength(1);
  });
});
