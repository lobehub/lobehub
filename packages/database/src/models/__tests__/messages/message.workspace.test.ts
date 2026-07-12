// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  chunks,
  fileChunks,
  files,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  sessions,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-workspace-user';
const workspaceId = 'message-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(sessions).values([
    { id: 'personal-session', userId, workspaceId: null },
    { id: 'workspace-session', userId, workspaceId },
  ]);
  await serverDB.insert(topics).values([
    { id: 'personal-topic', sessionId: 'personal-session', userId, workspaceId: null },
    { id: 'workspace-topic', sessionId: 'workspace-session', userId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageModel workspace scope', () => {
  it('isolates personal and workspace messages for the same user', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'personal',
        id: 'personal-message',
        role: 'user',
        sessionId: 'personal-session',
        topicId: 'personal-topic',
        userId,
        workspaceId: null,
      },
      {
        content: 'workspace',
        id: 'workspace-message',
        role: 'user',
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
        userId,
        workspaceId,
      },
    ]);

    await expect(
      new MessageModel(serverDB, userId).query({
        sessionId: 'personal-session',
        topicId: 'personal-topic',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'personal-message' })]);
    await expect(
      new MessageModel(serverDB, userId, workspaceId).query({
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'workspace-message' })]);
  });

  describe('message file references after a visibility flip', () => {
    const memberId = 'message-workspace-member';

    beforeEach(async () => {
      await serverDB.insert(users).values({ id: memberId });
      await serverDB.insert(messages).values({
        content: 'shared message with attachment',
        id: 'shared-message',
        role: 'user',
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
        userId,
        workspaceId,
      });
      await serverDB.insert(files).values({
        fileType: 'application/pdf',
        id: 'shared-file',
        name: 'quarterly-report.pdf',
        size: 2048,
        url: 'files/quarterly-report.pdf',
        userId,
        visibility: 'public',
        workspaceId,
      });
      await serverDB.insert(messagesFiles).values({
        fileId: 'shared-file',
        messageId: 'shared-message',
        userId,
        workspaceId,
      });
    });

    it('tombstones the file card for a member once the owner flips it back to private', async () => {
      await serverDB.update(files).set({ visibility: 'private' });

      const [message] = await new MessageModel(serverDB, memberId, workspaceId).query({
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
      });

      expect(message.fileList).toEqual([
        { fileType: '', id: 'shared-file', inaccessible: true, name: '', size: 0, url: '' },
      ]);
    });

    it('keeps the owner view and restores members once the file is public again', async () => {
      // Owner always sees their own private file.
      await serverDB.update(files).set({ visibility: 'private' });
      const [ownerMessage] = await new MessageModel(serverDB, userId, workspaceId).query({
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
      });
      expect(ownerMessage.fileList).toEqual([
        expect.objectContaining({ id: 'shared-file', name: 'quarterly-report.pdf', size: 2048 }),
      ]);

      // Flipping back to public restores the member's card.
      await serverDB.update(files).set({ visibility: 'public' });
      const [memberMessage] = await new MessageModel(serverDB, memberId, workspaceId).query({
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
      });
      expect(memberMessage.fileList).toEqual([
        expect.objectContaining({ id: 'shared-file', name: 'quarterly-report.pdf' }),
      ]);
    });

    describe('RAG reference chunks', () => {
      beforeEach(async () => {
        const [chunk] = await serverDB
          .insert(chunks)
          .values({ text: 'secret chunk text', userId, workspaceId })
          .returning();
        await serverDB
          .insert(fileChunks)
          .values({ chunkId: chunk.id, fileId: 'shared-file', userId, workspaceId });
        const [query] = await serverDB
          .insert(messageQueries)
          .values({ messageId: 'shared-message', userId, workspaceId })
          .returning();
        await serverDB.insert(messageQueryChunks).values({
          chunkId: chunk.id,
          messageId: 'shared-message',
          queryId: query.id,
          similarity: '0.90000',
          userId,
          workspaceId,
        });
      });

      it('drops reference chunks for a member once the owner flips the file back to private', async () => {
        await serverDB.update(files).set({ visibility: 'private' });

        const [memberMessage] = await new MessageModel(serverDB, memberId, workspaceId).query({
          sessionId: 'workspace-session',
          topicId: 'workspace-topic',
        });
        expect(memberMessage.chunksList).toEqual([]);

        // Owner always sees chunks of their own private file.
        const [ownerMessage] = await new MessageModel(serverDB, userId, workspaceId).query({
          sessionId: 'workspace-session',
          topicId: 'workspace-topic',
        });
        expect(ownerMessage.chunksList).toEqual([
          expect.objectContaining({ fileId: 'shared-file', text: 'secret chunk text' }),
        ]);
      });

      it('drops reference chunks in queryByIds once the owner flips the file back to private', async () => {
        await serverDB.update(files).set({ visibility: 'private' });

        const [memberMessage] = await new MessageModel(serverDB, memberId, workspaceId).queryByIds([
          'shared-message',
        ]);
        expect(memberMessage.chunksList).toEqual([]);

        const [ownerMessage] = await new MessageModel(serverDB, userId, workspaceId).queryByIds([
          'shared-message',
        ]);
        expect(ownerMessage.chunksList).toEqual([
          expect.objectContaining({ fileId: 'shared-file', text: 'secret chunk text' }),
        ]);
      });
    });
  });
});
