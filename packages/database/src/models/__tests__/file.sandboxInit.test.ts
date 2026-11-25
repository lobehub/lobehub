// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  files,
  filesToSessions,
  messages,
  messagesFiles,
  sessions,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-sandbox-init-test-user';
const fileModel = new FileModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(files);
});

describe('FileModel.findFilesToInitInSandbox', () => {
  const sessionId = 'sandbox-session-1';
  const topicId = 'sandbox-topic-1';

  beforeEach(async () => {
    await serverDB.insert(sessions).values({ id: sessionId, userId });
    await serverDB.insert(topics).values([
      { id: topicId, sessionId, userId },
      { id: 'sandbox-topic-2', sessionId, userId },
    ]);
    await serverDB.insert(messages).values([
      { id: 'sandbox-msg-1', role: 'user', topicId, userId },
      { id: 'sandbox-msg-2', role: 'user', topicId: 'sandbox-topic-2', userId },
    ]);
    await serverDB.insert(files).values([
      { fileType: 'text/csv', id: 'sf-msg', name: 'msg.csv', size: 1, url: 'k-msg', userId },
      {
        fileType: 'application/pdf',
        id: 'sf-sess',
        name: 's.pdf',
        size: 2,
        url: 'k-sess',
        userId,
      },
      { fileType: 'text/plain', id: 'sf-both', name: 'both.txt', size: 3, url: 'k-both', userId },
      { fileType: 'text/plain', id: 'sf-other', name: 'o.txt', size: 4, url: 'k-other', userId },
    ]);
  });

  it('merges topic message files and session files, de-duped by id with messageId on message-only attachments', async () => {
    await serverDB.insert(messagesFiles).values([
      { fileId: 'sf-msg', messageId: 'sandbox-msg-1', userId },
      { fileId: 'sf-both', messageId: 'sandbox-msg-1', userId },
      // attached to a different topic → must be excluded
      { fileId: 'sf-other', messageId: 'sandbox-msg-2', userId },
    ]);
    await serverDB.insert(filesToSessions).values([
      { fileId: 'sf-sess', sessionId, userId },
      // also referenced via message → session scope wins (no messageId)
      { fileId: 'sf-both', sessionId, userId },
    ]);

    const result = await fileModel.findFilesToInitInSandbox(topicId);

    expect(result.map((file) => file.id).sort()).toEqual(['sf-both', 'sf-msg', 'sf-sess']);
    expect(result.find((file) => file.id === 'sf-both')).toEqual({
      fileType: 'text/plain',
      id: 'sf-both',
      name: 'both.txt',
      size: 3,
      url: 'k-both',
    });
    expect(result.find((file) => file.id === 'sf-msg')).toEqual({
      fileType: 'text/csv',
      id: 'sf-msg',
      messageId: 'sandbox-msg-1',
      name: 'msg.csv',
      size: 1,
      url: 'k-msg',
    });
    expect(result.find((file) => file.id === 'sf-sess')?.messageId).toBeUndefined();
  });

  it('returns an empty array when the topic has no associated files', async () => {
    const result = await fileModel.findFilesToInitInSandbox(topicId);
    expect(result).toEqual([]);
  });

  it('does not return files belonging to another user', async () => {
    await serverDB.insert(messages).values({
      id: 'sandbox-msg-other',
      role: 'user',
      topicId,
      userId: 'user2',
    });
    await serverDB.insert(files).values({
      fileType: 'text/plain',
      id: 'sf-user2',
      name: 'u2.txt',
      size: 5,
      url: 'k-u2',
      userId: 'user2',
    });
    await serverDB
      .insert(messagesFiles)
      .values({ fileId: 'sf-user2', messageId: 'sandbox-msg-other', userId: 'user2' });

    const result = await fileModel.findFilesToInitInSandbox(topicId);
    expect(result).toEqual([]);
  });
});
