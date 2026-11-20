// @vitest-environment node
import { ActivityTypeEnum, LayersEnum, TypesEnum } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';

/**
 * Bounded scenario file for the create contract: every optional column the
 * `create*Memory` params accept must reach the insert instead of falling back to
 * the column default. Kept out of `model.test.ts` because that file is already
 * past the size cap.
 */
const userId = 'memory-create-contract-user';

let memoryModel: UserMemoryModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(userMemoriesActivities);
  await serverDB.delete(userMemoriesContexts);
  await serverDB.delete(userMemoriesExperiences);
  await serverDB.delete(userMemoriesIdentities);
  await serverDB.delete(userMemoriesPreferences);
  await serverDB.delete(userMemories);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }]);
  memoryModel = new UserMemoryModel(serverDB, userId);
});

describe('UserMemoryModel create contract', () => {
  it('should persist the structured fields accepted by the activity create params', async () => {
    const result = await memoryModel.createActivityMemory({
      activity: {
        injectable: false,
        narrative: 'Did a thing',
        status: 'completed',
        type: ActivityTypeEnum.Other,
      },
      details: 'Activity details',
      memoryLayer: LayersEnum.Activity,
      memoryType: TypesEnum.Activity,
      summary: 'Activity summary',
      title: 'Activity structured fields',
    });

    const persisted = await serverDB.query.userMemoriesActivities.findFirst({
      where: eq(userMemoriesActivities.id, result.activity.id),
    });

    // `injectable` defaults to true, so false proves the param reached the insert.
    expect(persisted?.injectable).toBe(false);
  });

  it('should persist the structured fields accepted by the context create params', async () => {
    const firstSeenAt = new Date('2025-01-01T00:00:00.000Z');
    const lastEvidenceAt = new Date('2025-01-05T00:00:00.000Z');
    const synthesizedAt = new Date('2025-01-06T00:00:00.000Z');

    const result = await memoryModel.createContextMemory({
      context: {
        description: 'A test context',
        firstSeenAt,
        lastEvidenceAt,
        nextSteps: ['ship the schema'],
        now: 'wiring the create path',
        openQuestions: ['who owns the extraction?'],
        synthesizedAt,
        title: 'Test Context',
        type: 'project',
      },
      details: 'Context details',
      memoryLayer: LayersEnum.Context,
      memoryType: TypesEnum.Context,
      summary: 'Context summary',
      title: 'Context structured fields',
    });

    const persisted = await serverDB.query.userMemoriesContexts.findFirst({
      where: eq(userMemoriesContexts.id, result.context.id),
    });

    expect(persisted?.now).toBe('wiring the create path');
    expect(persisted?.nextSteps).toEqual(['ship the schema']);
    expect(persisted?.openQuestions).toEqual(['who owns the extraction?']);
    expect(persisted?.firstSeenAt).toEqual(firstSeenAt);
    expect(persisted?.lastEvidenceAt).toEqual(lastEvidenceAt);
    expect(persisted?.synthesizedAt).toEqual(synthesizedAt);
  });

  it('should persist the structured fields accepted by the preference create params', async () => {
    const lastEvidenceAt = new Date('2025-01-07T00:00:00.000Z');

    const result = await memoryModel.createPreferenceMemory({
      details: 'Preference details',
      memoryLayer: LayersEnum.Preference,
      memoryType: TypesEnum.Other,
      preference: {
        conclusionDirectives: 'Use compact cards',
        evidenceCount: 4,
        evidenceSource: 'reported',
        lastEvidenceAt,
        scope: 'ui-copy',
        suggestions: 'Prefer short answers',
        type: 'style',
      },
      summary: 'Preference summary',
      title: 'Preference structured fields',
    });

    const persisted = await serverDB.query.userMemoriesPreferences.findFirst({
      where: eq(userMemoriesPreferences.id, result.preference.id),
    });

    expect(persisted?.evidenceCount).toBe(4);
    expect(persisted?.evidenceSource).toBe('reported');
    expect(persisted?.scope).toBe('ui-copy');
    expect(persisted?.lastEvidenceAt).toEqual(lastEvidenceAt);
  });
});
