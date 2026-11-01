// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { files, messages, messagesFiles, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { FILE_URL_POST_PROCESS_CONCURRENCY } from '../../message/attachments';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-file-url-concurrency-test';
const messageModel = new MessageModel(serverDB, userId);
const FILE_COUNT = FILE_URL_POST_PROCESS_CONCURRENCY + 5;
const fileIds = Array.from({ length: FILE_COUNT }, (_, index) => `fuc-file-${index}`);

/** Presigner that records the peak number of in-flight calls. */
const createTrackingPostProcessUrl = () => {
  let inFlight = 0;
  const stats = { calls: 0, maxInFlight: 0 };
  const postProcessUrl = async (path: string | null, file: { id?: string | null }) => {
    stats.calls += 1;
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return `https://cdn.example.com/${file.id}/${path}`;
  };
  return { postProcessUrl, stats };
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(messages).values({
    content: 'message with many attachments',
    id: 'fuc-message',
    role: 'user',
    userId,
  });
  await serverDB
    .insert(files)
    .values(
      fileIds.map((id) => ({ fileType: 'image/png', id, name: id, size: 100, url: 'raw', userId })),
    );
  await serverDB
    .insert(messagesFiles)
    .values(fileIds.map((fileId) => ({ fileId, messageId: 'fuc-message', userId })));
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('MessageModel attachment URL post-processing', () => {
  it('caps concurrent postProcessUrl calls in query', async () => {
    const { postProcessUrl, stats } = createTrackingPostProcessUrl();

    const [message] = await messageModel.query({}, { postProcessUrl });

    expect(stats.calls).toBe(FILE_COUNT);
    expect(stats.maxInFlight).toBeLessThanOrEqual(FILE_URL_POST_PROCESS_CONCURRENCY);
    expect(message.imageList).toHaveLength(FILE_COUNT);
    for (const image of message.imageList ?? []) {
      expect(image.url).toBe(`https://cdn.example.com/${image.id}/raw`);
    }
  });

  it('caps concurrent postProcessUrl calls in queryByIds', async () => {
    const { postProcessUrl, stats } = createTrackingPostProcessUrl();

    const [message] = await messageModel.queryByIds(['fuc-message'], { postProcessUrl });

    expect(stats.calls).toBe(FILE_COUNT);
    expect(stats.maxInFlight).toBeLessThanOrEqual(FILE_URL_POST_PROCESS_CONCURRENCY);
    expect(message.imageList).toHaveLength(FILE_COUNT);
  });
});
