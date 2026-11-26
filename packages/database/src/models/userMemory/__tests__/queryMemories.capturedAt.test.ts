// @vitest-environment node
import { LayersEnum } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';

const userId = 'memory-captured-at-test-user';

let memoryModel: UserMemoryModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(userMemoriesContexts);
  await serverDB.delete(userMemoriesExperiences);
  await serverDB.delete(userMemoriesPreferences);
  await serverDB.delete(userMemories);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }]);
  memoryModel = new UserMemoryModel(serverDB, userId);
});

describe('UserMemoryModel.queryMemories capturedAt projection', () => {
  const capturedAt = new Date('2025-03-15T12:00:00.000Z');
  const createdAt = new Date('2026-11-22T12:00:00.000Z');

  it('returns capturedAt for Context list items distinct from createdAt/updatedAt', async () => {
    const [mem] = await serverDB
      .insert(userMemories)
      .values({
        capturedAt,
        createdAt,
        details: 'context details',
        lastAccessedAt: createdAt,
        memoryLayer: 'context',
        memoryType: 'context',
        summary: 'context summary',
        title: 'Context memory',
        updatedAt: createdAt,
        userId,
      })
      .returning();

    await serverDB.insert(userMemoriesContexts).values({
      capturedAt,
      createdAt,
      description: 'Context description',
      title: 'Quarterly architecture review',
      type: 'project',
      updatedAt: createdAt,
      userId,
      userMemoryIds: [mem.id],
    });

    const result = await memoryModel.queryMemories({ layer: LayersEnum.Context });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.layer).toBe(LayersEnum.Context);
    if (item.layer === LayersEnum.Context) {
      expect(item.context.capturedAt).toEqual(capturedAt);
      expect(item.context.capturedAt.getTime()).not.toBe(item.context.createdAt.getTime());
    }
  });

  it('returns capturedAt for Experience list items distinct from createdAt/updatedAt', async () => {
    const [mem] = await serverDB
      .insert(userMemories)
      .values({
        capturedAt,
        createdAt,
        details: 'experience details',
        lastAccessedAt: createdAt,
        memoryLayer: 'experience',
        memoryType: 'experience',
        summary: 'experience summary',
        title: 'Experience memory',
        updatedAt: createdAt,
        userId,
      })
      .returning();

    await serverDB.insert(userMemoriesExperiences).values({
      action: 'Diagnosed missing projection column',
      capturedAt,
      createdAt,
      keyLearning: 'Include capturedAt in list queries',
      situation: 'Batch memory extraction',
      type: 'learning',
      updatedAt: createdAt,
      userId,
      userMemoryId: mem.id,
    });

    const result = await memoryModel.queryMemories({ layer: LayersEnum.Experience });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.layer).toBe(LayersEnum.Experience);
    if (item.layer === LayersEnum.Experience) {
      expect(item.experience.capturedAt).toEqual(capturedAt);
      expect(item.experience.capturedAt.getTime()).not.toBe(item.experience.createdAt.getTime());
    }
  });

  it('returns capturedAt for Preference list items distinct from createdAt/updatedAt', async () => {
    const [mem] = await serverDB
      .insert(userMemories)
      .values({
        capturedAt,
        createdAt,
        details: 'preference details',
        lastAccessedAt: createdAt,
        memoryLayer: 'preference',
        memoryType: 'preference',
        summary: 'preference summary',
        title: 'Prefer concise technical summaries',
        updatedAt: createdAt,
        userId,
      })
      .returning();

    await serverDB.insert(userMemoriesPreferences).values({
      capturedAt,
      conclusionDirectives: 'Keep explanations concise and lead with root cause.',
      createdAt,
      type: 'communication',
      updatedAt: createdAt,
      userId,
      userMemoryId: mem.id,
    });

    const result = await memoryModel.queryMemories({ layer: LayersEnum.Preference });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.layer).toBe(LayersEnum.Preference);
    if (item.layer === LayersEnum.Preference) {
      expect(item.preference.capturedAt).toEqual(capturedAt);
      expect(item.preference.capturedAt.getTime()).not.toBe(item.preference.createdAt.getTime());
    }
  });
});
