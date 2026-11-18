// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { files, messages, messagesFiles, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-file-kinds-test';
const messageModel = new MessageModel(serverDB, userId);
const postProcessUrl = async (path: string | null) => `https://cdn.example.com/${path}`;

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(messages).values({
    content: 'a photo, a CAD drawing, a voice note and a clip',
    id: 'fk-message',
    role: 'user',
    userId,
  });
  await serverDB.insert(files).values([
    { fileType: 'image/jpeg', id: 'fk-photo', name: 'photo.jpg', size: 100, url: 'photo', userId },
    // Browsers report AutoCAD drawings as `image/vnd.dwg`; no vision model reads them
    { fileType: 'image/vnd.dwg', id: 'fk-dwg', name: 'plan.dwg', size: 100, url: 'dwg', userId },
    { fileType: 'audio/mpeg', id: 'fk-audio', name: 'note.mp3', size: 100, url: 'audio', userId },
    { fileType: 'video/mp4', id: 'fk-video', name: 'clip.mp4', size: 100, url: 'video', userId },
  ]);
  await serverDB.insert(messagesFiles).values([
    { fileId: 'fk-photo', messageId: 'fk-message', userId },
    { fileId: 'fk-dwg', messageId: 'fk-message', userId },
    { fileId: 'fk-audio', messageId: 'fk-message', userId },
    { fileId: 'fk-video', messageId: 'fk-message', userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('MessageModel attachment kinds', () => {
  it.each([
    ['query', () => messageModel.query({}, { postProcessUrl })],
    ['queryByIds', () => messageModel.queryByIds(['fk-message'], { postProcessUrl })],
  ])(
    '%s keeps image formats models cannot read out of imageList and leaves audio and video alone',
    async (_, run) => {
      const [message] = await run();

      expect(message.imageList?.map((image) => image.id)).toEqual(['fk-photo']);
      expect(message.fileList?.map((file) => file.id)).toEqual(['fk-dwg']);
      // Audio and video keep their own lists
      expect(message.audioList?.map((audio) => audio.id)).toEqual(['fk-audio']);
      expect(message.videoList?.map((video) => video.id)).toEqual(['fk-video']);
    },
  );
});
