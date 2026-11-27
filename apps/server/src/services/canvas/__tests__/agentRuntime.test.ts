// @vitest-environment node
import { createMediaFileRef } from '@lobechat/const/mediaRef';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agents,
  chatGroups,
  files,
  messages,
  messagesFiles,
  topics,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';

import { createCanvasFileRefResolverFor, createCanvasOpenUrlResolver } from '../agentRuntime';

const { getFileByteArray } = vi.hoisted(() => ({ getFileByteArray: vi.fn() }));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com/' } }));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileByteArray = getFileByteArray;
  },
}));

const serverDB = await getTestDB();
const userId = 'canvas-ref-user';
const otherUserId = 'canvas-ref-other';
const agentId = 'canvas-ref-agent';
const topicId = 'canvas-ref-topic';
const messageId = 'canvas-ref-message';
const png = new Uint8Array([137, 80, 78, 71]);

const fileRow = (id: string, owner: string) => ({
  fileType: 'image/png',
  id,
  name: `${id}.png`,
  size: png.byteLength,
  url: `files/${owner}/${id}.png`,
  userId: owner,
});

beforeEach(async () => {
  getFileByteArray.mockReset().mockResolvedValue(png);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
  await serverDB.insert(topics).values({ agentId, id: topicId, userId });
  await serverDB
    .insert(files)
    .values([fileRow('file_photo', userId), fileRow('file_foreign', otherUserId)]);
  await serverDB
    .insert(messages)
    .values({ agentId, content: 'use this', id: messageId, role: 'user', topicId, userId });
  await serverDB.insert(messagesFiles).values({ fileId: 'file_photo', messageId, userId });
});

describe('createCanvasFileRefResolverFor', () => {
  it('resolves an image attached in the topic by its media ref', async () => {
    const resolve = createCanvasFileRefResolverFor(serverDB, { agentId, topicId, userId });
    const ref = createMediaFileRef({ index: 0, messageId, type: 'image' });

    const result = await resolve([{ fileRef: ref, path: 'img/photo.png' }]);

    expect(result.issues).toEqual([]);
    expect(result.contents.get(ref)).toBe(png);
    expect(getFileByteArray).toHaveBeenCalledWith(`files/${userId}/file_photo.png`);
  });

  it("does not read another user's file", async () => {
    const resolve = createCanvasFileRefResolverFor(serverDB, { agentId, topicId, userId });

    const result = await resolve([{ fileRef: 'file_foreign', path: 'img/x.png' }]);

    expect(result.issues.map((issue) => issue.rule)).toEqual(['unresolved-file-ref']);
    expect(getFileByteArray).not.toHaveBeenCalled();
  });
});

describe('createCanvasOpenUrlResolver', () => {
  it('links to the conversation of the topic', async () => {
    const resolve = createCanvasOpenUrlResolver(serverDB, { agentId, topicId, userId });

    await expect(resolve('cvs_1')).resolves.toBe(
      `https://app.example.com/agent/${agentId}/${topicId}?canvas=cvs_1`,
    );
  });

  it("uses the topic's agent when a sub-agent saves the canvas", async () => {
    const resolve = createCanvasOpenUrlResolver(serverDB, {
      agentId: 'canvas-sub-agent',
      topicId,
      userId,
    });

    await expect(resolve('cvs_1')).resolves.toContain(`/agent/${agentId}/${topicId}?`);
  });

  it('keeps a workspace conversation under its slug', async () => {
    const workspaceId = 'canvas-link-ws';
    const workspaceTopicId = 'canvas-link-ws-topic';
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: 'acme' });
    await serverDB.insert(workspaceMembers).values({ role: 'owner', userId, workspaceId });
    await serverDB.insert(topics).values({ agentId, id: workspaceTopicId, userId, workspaceId });

    const resolve = createCanvasOpenUrlResolver(serverDB, {
      agentId,
      topicId: workspaceTopicId,
      userId,
      workspaceId,
    });

    await expect(resolve('cvs_1')).resolves.toBe(
      `https://app.example.com/acme/agent/${agentId}/${workspaceTopicId}?canvas=cvs_1`,
    );
  });

  it('returns no link for a group conversation, which has no Canvas panel', async () => {
    const groupId = 'canvas-link-group';
    const groupTopicId = 'canvas-link-group-topic';
    await serverDB.insert(chatGroups).values({ id: groupId, title: 'group', userId });
    await serverDB.insert(topics).values({ agentId, groupId, id: groupTopicId, userId });

    const resolve = createCanvasOpenUrlResolver(serverDB, {
      agentId,
      topicId: groupTopicId,
      userId,
    });

    await expect(resolve('cvs_1')).resolves.toBeUndefined();
  });

  it("returns no link for another user's topic", async () => {
    const resolve = createCanvasOpenUrlResolver(serverDB, {
      agentId,
      topicId,
      userId: otherUserId,
    });

    await expect(resolve('cvs_1')).resolves.toBeUndefined();
  });
});
