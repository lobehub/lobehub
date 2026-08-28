// @vitest-environment node
import type { RegisterFileWorkParams } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { works } from '../../../schemas';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  threadId,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

const baseFileParams = (
  overrides: Partial<RegisterFileWorkParams> = {},
): RegisterFileWorkParams => ({
  agentId,
  filePath: '/mnt/data/deck.pptx',
  metadata: {
    fileId: 'file-123',
    filePath: '/mnt/data/deck.pptx',
    fileSize: 2048,
    fileUrl: 'https://cdn.example.com/deck.pptx',
    linesAdded: 0,
    linesDeleted: 0,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  rootOperationId: 'op-file-1',
  threadId,
  title: 'deck.pptx',
  toolCallId: 'op:op-file-1',
  toolIdentifier: 'lobe-cloud-sandbox',
  toolName: 'writeFile',
  topicId,
  userId,
  ...overrides,
});

describe('WorkModel · file', () => {
  it('keys resource identity on userId:topicId:filePath and denormalizes path + url', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const work = await workModel.registerFile(baseFileParams());

    expect(work).toMatchObject({
      // The sandbox is per user+topic, so the resource id carries the user.
      resourceId: `${userId}:${topicId}:/mnt/data/deck.pptx`,
      resourceType: 'file',
      type: 'file',
      visibility: 'private',
    });
    // Denormalized display columns so list rows render without version metadata.
    expect(work.title).toBe('deck.pptx');
    expect(work.description).toBe('/mnt/data/deck.pptx');
    expect(work.url).toBe('https://cdn.example.com/deck.pptx');
    // `identifier` is denormalized to the basename (the file's "human reference")
    // so the sidebar's fallback label shows the filename, not the internal
    // `resourceId` (`userId:topicId:filePath`).
    expect(work.identifier).toBe('deck.pptx');

    const versions = await workModel.listVersions(work.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      changeType: 'created',
      description: '/mnt/data/deck.pptx',
      // The basename identifier is stamped on the version row too.
      identifier: 'deck.pptx',
      metadata: { fileId: 'file-123', filePath: '/mnt/data/deck.pptx' },
      title: 'deck.pptx',
      toolCallId: 'op:op-file-1',
    });
  });

  it('adds a version to the same Work when the file is re-edited in a later operation', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const first = await workModel.registerFile(baseFileParams());
    const second = await workModel.registerFile(
      baseFileParams({ rootOperationId: 'op-file-2', toolCallId: 'op:op-file-2' }),
    );

    expect(second.id).toBe(first.id);

    const rows = await serverDB.select().from(works);
    expect(rows).toHaveLength(1);

    const versions = await workModel.listVersions(first.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    // A later registration is `updated`, not `created`.
    expect(versions[0].changeType).toBe('updated');
  });

  it('does not collide across users editing the same path in a shared topic', async () => {
    const ownerWorks = new WorkModel(serverDB, userId);
    const memberWorks = new WorkModel(serverDB, userId2);

    const ownerWork = await ownerWorks.registerFile(baseFileParams());
    // Member B registers the same path — distinct resource identity via userId,
    // so it must create a SEPARATE Work rather than clash on the workspace
    // unique index (which does not include userId).
    const memberWork = await memberWorks.registerFile(
      baseFileParams({ agentId: undefined, userId: userId2 }),
    );

    expect(memberWork.id).not.toBe(ownerWork.id);
    expect(memberWork.resourceId).toBe(`${userId2}:${topicId}:/mnt/data/deck.pptx`);

    const rows = await serverDB.select().from(works);
    expect(rows).toHaveLength(2);
  });

  describe('findFileVersionByToolCall', () => {
    it('returns the version once a (op) registration exists, null before', async () => {
      const workModel = new WorkModel(serverDB, userId);

      const probeParams = {
        filePath: '/mnt/data/deck.pptx',
        toolCallId: 'op:op-file-1',
        topicId,
        userId,
      };

      expect(await workModel.findFileVersionByToolCall(probeParams)).toBeNull();

      await workModel.registerFile(baseFileParams());

      const found = await workModel.findFileVersionByToolCall(probeParams);
      expect(found).not.toBeNull();
      expect(typeof found?.id).toBe('string');

      // A different operation's dedup key has no version yet.
      expect(
        await workModel.findFileVersionByToolCall({ ...probeParams, toolCallId: 'op:op-file-2' }),
      ).toBeNull();
    });

    it('is scoped to the owning user', async () => {
      const ownerWorks = new WorkModel(serverDB, userId);
      const memberWorks = new WorkModel(serverDB, userId2);

      await ownerWorks.registerFile(baseFileParams());

      // Member B probing with their own userId resolves a different resourceId.
      expect(
        await memberWorks.findFileVersionByToolCall({
          filePath: '/mnt/data/deck.pptx',
          toolCallId: 'op:op-file-1',
          topicId,
          userId: userId2,
        }),
      ).toBeNull();
    });
  });
});
