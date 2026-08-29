import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messageGroups, messages, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CompressionRepository } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

/**
 * `guardShareProvenance` walls the generic compression surface off from Agent
 * Share conversations — see `CompressionRepositoryOptions.guardShareProvenance`.
 * `visitorId` owns the share conversation rows; `creatorId` owns the agent.
 */
const visitorId = 'compression-share-guard-visitor';
const creatorId = 'compression-share-guard-creator';
const agentId = 'compression-share-guard-agent';
const shareId = '00000000-0000-4000-8000-000000000003';

const guardedRepo = new CompressionRepository(serverDB, visitorId, undefined, {
  guardShareProvenance: true,
});
const internalRepo = new CompressionRepository(serverDB, visitorId);

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, visitorId));
    await trx.delete(users).where(eq(users.id, creatorId));
    await trx.insert(users).values([{ id: visitorId }, { id: creatorId }]);
    await trx.insert(agents).values({ id: agentId, title: 'Shared', userId: creatorId });
    await trx.insert(topics).values([
      { agentId, id: 'cg-share-topic', shareId, title: 'Share', userId: visitorId },
      { id: 'cg-plain-topic', title: 'Plain', userId: visitorId },
    ]);
    await trx.insert(messages).values([
      {
        content: 'turn',
        id: 'cg-share-msg',
        role: 'user',
        topicId: 'cg-share-topic',
        userId: visitorId,
      },
      {
        content: 'chat',
        id: 'cg-plain-msg',
        role: 'user',
        topicId: 'cg-plain-topic',
        userId: visitorId,
      },
    ]);
    await trx.insert(messageGroups).values({
      content: '...',
      id: 'cg-share-group',
      topicId: 'cg-share-topic',
      type: 'compression',
      userId: visitorId,
    });
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, visitorId));
  await serverDB.delete(users).where(eq(users.id, creatorId));
});

describe('CompressionRepository guardShareProvenance', () => {
  it('refuses to create a compression group on a share topic', async () => {
    await expect(
      guardedRepo.createCompressionGroup({
        content: 'x'.repeat(10),
        messageIds: ['cg-share-msg'],
        metadata: { originalMessageCount: 1 },
        topicId: 'cg-share-topic',
      }),
    ).rejects.toThrow(/belongs to an agent share/);
  });

  it('still creates compression groups on ordinary topics', async () => {
    const groupId = await guardedRepo.createCompressionGroup({
      content: 'summary',
      messageIds: ['cg-plain-msg'],
      metadata: { originalMessageCount: 1 },
      topicId: 'cg-plain-topic',
    });
    expect(groupId).toBeTruthy();
  });

  it('refuses to finalize a compression group on a share topic — the unbounded summary path', async () => {
    await expect(
      guardedRepo.finalizeCompressionGroup({
        content: 'x'.repeat(10),
        groupId: 'cg-share-group',
        topicId: 'cg-share-topic',
      }),
    ).rejects.toThrow(/belongs to an agent share/);

    const [row] = await serverDB
      .select()
      .from(messageGroups)
      .where(eq(messageGroups.id, 'cg-share-group'));
    expect(row.content).toBe('...');
  });

  it('refuses group-id writes whose group lives on a share topic', async () => {
    await expect(
      guardedRepo.updateCompressionContent('cg-share-group', 'x'.repeat(10)),
    ).rejects.toThrow(/belongs to an agent share/);
    await expect(guardedRepo.updateMetadata('cg-share-group', { expanded: true })).rejects.toThrow(
      /belongs to an agent share/,
    );
    await expect(guardedRepo.deleteCompressionGroup('cg-share-group')).rejects.toThrow(
      /belongs to an agent share/,
    );
  });

  it('refuses message-id writes on share rows', async () => {
    await expect(
      guardedRepo.markMessagesAsCompressed(['cg-share-msg'], 'cg-share-group'),
    ).rejects.toThrow(/belongs to an agent share/);
    await expect(guardedRepo.unmarkMessagesFromCompression(['cg-share-msg'])).rejects.toThrow(
      /belongs to an agent share/,
    );
    await expect(guardedRepo.toggleMessagePin('cg-share-msg', true)).rejects.toThrow(
      /belongs to an agent share/,
    );
  });

  it('leaves internal (unguarded) writers untouched', async () => {
    await internalRepo.finalizeCompressionGroup({
      content: 'internal summary',
      groupId: 'cg-share-group',
      topicId: 'cg-share-topic',
    });

    const [row] = await serverDB
      .select()
      .from(messageGroups)
      .where(eq(messageGroups.id, 'cg-share-group'));
    expect(row.content).toBe('internal summary');
  });
});
