// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { aiModels, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiModelModel } from '../aiModel';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'aimcov-user';
const providerId = 'aimcov-provider';
const model = new AiModelModel(serverDB, userId);

const findRow = async (id: string) =>
  serverDB.query.aiModels.findFirst({
    where: and(
      eq(aiModels.id, id),
      eq(aiModels.providerId, providerId),
      eq(aiModels.userId, userId),
    ),
  });

const cleanup = async () => {
  // ai_models cascades from the owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('AiModelModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('getAllModelReasoningConfigs', () => {
    it('skips rows whose chatConfig key is present but null', async () => {
      await serverDB.insert(aiModels).values([
        {
          config: { chatConfig: null } as any,
          id: 'aimcov-null-chat-config',
          providerId,
          userId,
        },
        {
          config: { chatConfig: { enableReasoning: true } } as any,
          id: 'aimcov-with-chat-config',
          providerId,
          userId,
        },
      ]);

      const configs = await model.getAllModelReasoningConfigs();

      expect(configs).toEqual({
        [`${providerId}/aimcov-with-chat-config`]: { enableReasoning: true },
      });
    });
  });

  describe('toggleModelEnabled', () => {
    it('leaves the column default type when neither the input nor a builtin card has one', async () => {
      await model.toggleModelEnabled({
        enabled: true,
        id: 'aimcov-unknown-custom-model',
        providerId,
      });

      const row = await findRow('aimcov-unknown-custom-model');
      expect(row).toMatchObject({ enabled: true, type: 'chat' });
    });
  });

  describe('batchUpdateAiModels', () => {
    it('writes provided parameters and optional internal fields on insert', async () => {
      const [inserted] = await model.batchUpdateAiModels(providerId, [
        {
          config: { deploymentName: 'aimcov-deployment' },
          description: 'aimcov description',
          enabled: false,
          id: 'aimcov-batch-model',
          organization: 'aimcov-org',
          parameters: { temperature: { default: 0.5 } },
          settings: { searchImpl: 'params' },
          sort: 7,
          source: 'remote',
        } as any,
      ]);

      expect(inserted).toMatchObject({
        config: { deploymentName: 'aimcov-deployment' },
        description: 'aimcov description',
        enabled: false,
        id: 'aimcov-batch-model',
        organization: 'aimcov-org',
        parameters: { temperature: { default: 0.5 } },
        settings: { searchImpl: 'params' },
        sort: 7,
        source: 'remote',
      });
      expect(await findRow('aimcov-batch-model')).toMatchObject({
        organization: 'aimcov-org',
        parameters: { temperature: { default: 0.5 } },
        sort: 7,
      });
    });

    it('stores an explicitly empty parameter set as null instead of the column default', async () => {
      const [inserted] = await model.batchUpdateAiModels(providerId, [
        { id: 'aimcov-empty-params', parameters: { temperature: null } } as any,
      ]);

      expect(inserted.parameters).toBeNull();
      expect((await findRow('aimcov-empty-params'))?.parameters).toBeNull();
    });
  });
});
