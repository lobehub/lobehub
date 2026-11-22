// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { files, messagePlugins, messages, topics, users } from '@/database/schemas';

import { AgentWorkRunError, resolveAgentWorkCollectionItems } from './agentWork';

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = async (file: { id: string }) => `https://app.example.com/f/${file.id}`;
  },
}));

const db = await getTestDB();
const userId = 'collection-proof-user';
const topicId = 'collection-proof-topic';
const otherTopicId = 'collection-proof-other-topic';
const fileId = 'file_exported';

/** A tool call message of `topic` with its plugin row. */
const toolCall = async (
  id: string,
  plugin: { apiName: string; identifier: string; state?: unknown },
  content: string,
  topic = topicId,
) => {
  await db.insert(messages).values({ content, id, role: 'tool', topicId: topic, userId });
  await db.insert(messagePlugins).values({ id, userId, ...plugin });
};

const exportCall = (id: string, state: unknown, topic?: string) =>
  toolCall(
    id,
    { apiName: 'exportFile', identifier: 'lobe-cloud-sandbox', state },
    `File exported successfully.\n\nDownload URL: https://app.example.com/f/${fileId}`,
    topic,
  );

const resolve = (options: { shareVisitor?: boolean; topicId?: string } = {}) =>
  resolveAgentWorkCollectionItems({
    db,
    items: [{ image: `https://app.example.com/f/${fileId}` }],
    shareVisitor: options.shareVisitor,
    topicId: 'topicId' in options ? options.topicId : topicId,
    userId,
  });

const expectNotFound = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AgentWorkRunError);
  expect((error as AgentWorkRunError).status).toBe(404);
};

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(topics).values([
    { id: topicId, userId },
    { id: otherTopicId, userId },
  ]);
  // The cloud sandbox stores its exports without a source.
  await db.insert(files).values({
    fileType: 'image/png',
    id: fileId,
    name: 'collection.png',
    size: 1024,
    url: 'files/collection.png',
    userId,
  });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('resolveAgentWorkCollectionItems for an image without a source', () => {
  it('accepts the file a sandbox exportFile call of the run conversation produced', async () => {
    await exportCall('msg_export', { fileId, success: true });

    await expect(resolve()).resolves.toEqual([
      { fileId, mimeType: 'image/png', url: `https://app.example.com/f/${fileId}` },
    ]);
    // A share visitor's own conversation proves it the same way.
    await expect(resolve({ shareVisitor: true })).resolves.toHaveLength(1);
  });

  it('refuses it when only message text names it', async () => {
    // This tool's own refusal, and any tool echoing the link, name the id in
    // their text; neither produced the file.
    await toolCall(
      'msg_refusal',
      { apiName: 'createWork', identifier: 'lobe-work', state: { error: { code: 'not_found' } } },
      `Image ${fileId} not found`,
    );
    await toolCall(
      'msg_echo',
      { apiName: 'runCommand', identifier: 'lobe-cloud-sandbox', state: { success: true } },
      `Download URL: https://app.example.com/f/${fileId}`,
    );

    await expectNotFound(resolve());
    await expectNotFound(resolve({ shareVisitor: true }));
  });

  it('refuses an export of another conversation or a run without one', async () => {
    await exportCall('msg_export_elsewhere', { fileId, success: true }, otherTopicId);

    await expectNotFound(resolve());
    await expectNotFound(resolve({ topicId: undefined }));
  });
});
