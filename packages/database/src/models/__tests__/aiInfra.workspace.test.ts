// @vitest-environment node
import { eq } from 'drizzle-orm';
import type { AiProviderModelListItem } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { aiModels, aiProviders, apiKeys, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiModelModel } from '../aiModel';
import { AiProviderModel } from '../aiProvider';
import { ApiKeyModel } from '../apiKey';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'ai-infra-workspace-user';
const workspaceId = 'ai-infra-workspace';
const validKeyVaultsSecret = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';

let originalKeyVaultsSecret: string | undefined;

beforeEach(async () => {
  originalKeyVaultsSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = validKeyVaultsSecret;

  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
  process.env.KEY_VAULTS_SECRET = originalKeyVaultsSecret;
});

describe('ApiKeyModel workspace scope', () => {
  it('isolates personal and workspace API keys for the same user', async () => {
    const personalModel = new ApiKeyModel(serverDB, userId);
    const workspaceModel = new ApiKeyModel(serverDB, userId, workspaceId);

    const personalKey = await personalModel.create({ enabled: true, name: 'Personal key' });
    const workspaceKey = await workspaceModel.create({ enabled: true, name: 'Workspace key' });

    await expect(personalModel.query()).resolves.toEqual([
      expect.objectContaining({ id: personalKey.id, workspaceId: null }),
    ]);
    await expect(workspaceModel.query()).resolves.toEqual([
      expect.objectContaining({ id: workspaceKey.id, workspaceId }),
    ]);

    await expect(personalModel.findById(workspaceKey.id)).resolves.toBeUndefined();
    await expect(workspaceModel.findById(personalKey.id)).resolves.toBeUndefined();

    await personalModel.deleteAll();

    const remainingKeys = await serverDB.query.apiKeys.findMany({
      where: eq(apiKeys.userId, userId),
    });
    expect(remainingKeys).toEqual([expect.objectContaining({ id: workspaceKey.id })]);
  });
});

describe('AiProviderModel workspace scope', () => {
  it('keeps provider config separate when personal and workspace use the same provider id', async () => {
    const personalModel = new AiProviderModel(serverDB, userId);
    const workspaceModel = new AiProviderModel(serverDB, userId, workspaceId);

    await personalModel.updateConfig('openai', {
      keyVaults: { apiKey: 'personal-key' },
    });
    await workspaceModel.updateConfig('openai', {
      keyVaults: { apiKey: 'workspace-key' },
    });

    await expect(personalModel.query()).resolves.toEqual([
      expect.objectContaining({ id: 'openai', workspaceId: null }),
    ]);
    await expect(workspaceModel.query()).resolves.toEqual([
      expect.objectContaining({ id: 'openai', workspaceId }),
    ]);

    await expect(personalModel.getAiProviderById('openai')).resolves.toMatchObject({
      keyVaults: { apiKey: 'personal-key' },
    });
    await expect(workspaceModel.getAiProviderById('openai')).resolves.toMatchObject({
      keyVaults: { apiKey: 'workspace-key' },
    });
  });

  it('uses workspace-aware conflict targets for provider upsert helpers', async () => {
    const personalModel = new AiProviderModel(serverDB, userId);
    const workspaceModel = new AiProviderModel(serverDB, userId, workspaceId);

    await personalModel.updateConfig('openai', {
      keyVaults: { apiKey: 'personal-key' },
    });
    await workspaceModel.updateConfig('openai', {
      keyVaults: { apiKey: 'workspace-key' },
    });

    await personalModel.toggleProviderEnabled('openai', false);
    await workspaceModel.toggleProviderEnabled('openai', true);

    await personalModel.updateOrder([{ id: 'openai', sort: 10 }]);
    await workspaceModel.updateOrder([{ id: 'openai', sort: 20 }]);

    const rows = await serverDB.query.aiProviders.findMany({
      where: eq(aiProviders.userId, userId),
    });

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: false,
          id: 'openai',
          sort: 10,
          workspaceId: null,
        }),
        expect.objectContaining({
          enabled: true,
          id: 'openai',
          sort: 20,
          workspaceId,
        }),
      ]),
    );
  });

  it('shares a single workspace provider row across members (conflict on workspace, not creator)', async () => {
    const otherUserId = 'ai-infra-workspace-user-2';
    await serverDB.insert(users).values({ id: otherUserId });

    const memberA = new AiProviderModel(serverDB, userId, workspaceId);
    const memberB = new AiProviderModel(serverDB, otherUserId, workspaceId);

    await memberA.updateConfig('openai', { keyVaults: { apiKey: 'member-a-key' } });
    // A different member upserting the same provider must update the shared row,
    // not insert a second workspace row keyed by their own user_id.
    await memberB.updateConfig('openai', { keyVaults: { apiKey: 'member-b-key' } });

    const workspaceRows = await serverDB.query.aiProviders.findMany({
      where: eq(aiProviders.workspaceId, workspaceId),
    });
    expect(workspaceRows).toHaveLength(1);

    await expect(memberA.getAiProviderById('openai')).resolves.toMatchObject({
      keyVaults: { apiKey: 'member-b-key' },
    });
  });

  it('scopes provider CRUD helpers to personal and workspace rows', async () => {
    const personalModel = new AiProviderModel(serverDB, userId);
    const workspaceModel = new AiProviderModel(serverDB, userId, workspaceId);

    await personalModel.create({
      id: 'scoped-provider',
      name: 'Personal provider',
      source: 'custom',
    });
    await workspaceModel.create({
      id: 'scoped-provider',
      name: 'Workspace provider',
      source: 'custom',
    });

    await personalModel.update('scoped-provider', { name: 'Updated personal provider' });

    await expect(personalModel.findById('scoped-provider')).resolves.toMatchObject({
      name: 'Updated personal provider',
      workspaceId: null,
    });
    await expect(workspaceModel.findById('scoped-provider')).resolves.toMatchObject({
      name: 'Workspace provider',
      workspaceId,
    });

    await personalModel.delete('scoped-provider');

    await expect(personalModel.findById('scoped-provider')).resolves.toBeUndefined();
    await expect(workspaceModel.findById('scoped-provider')).resolves.toMatchObject({
      name: 'Workspace provider',
      workspaceId,
    });
  });
});

describe('AiModelModel workspace scope', () => {
  it('keeps model config separate when personal and workspace use the same model id', async () => {
    const personalModel = new AiModelModel(serverDB, userId);
    const workspaceModel = new AiModelModel(serverDB, userId, workspaceId);

    await personalModel.toggleModelEnabled({
      enabled: false,
      id: 'gpt-4o',
      providerId: 'openai',
      type: 'chat',
    });
    await workspaceModel.toggleModelEnabled({
      enabled: true,
      id: 'gpt-4o',
      providerId: 'openai',
      type: 'chat',
    });

    await expect(personalModel.query()).resolves.toEqual([
      expect.objectContaining({ enabled: false, id: 'gpt-4o', workspaceId: null }),
    ]);
    await expect(workspaceModel.query()).resolves.toEqual([
      expect.objectContaining({ enabled: true, id: 'gpt-4o', workspaceId }),
    ]);

    const rows = await serverDB.query.aiModels.findMany({
      where: eq(aiModels.userId, userId),
    });
    expect(rows).toHaveLength(2);
  });

  it('uses workspace-aware conflict targets for model upsert helpers', async () => {
    const personalModel = new AiModelModel(serverDB, userId);
    const workspaceModel = new AiModelModel(serverDB, userId, workspaceId);

    await personalModel.update('upsert-model', 'openai', {
      displayName: 'Personal model',
    });
    await workspaceModel.update('upsert-model', 'openai', {
      displayName: 'Workspace model',
    });

    const remoteModels = [
      {
        displayName: 'Personal remote model',
        id: 'remote-model',
      },
    ] as AiProviderModelListItem[];
    const workspaceRemoteModels = [
      {
        displayName: 'Workspace remote model',
        id: 'remote-model',
      },
    ] as AiProviderModelListItem[];

    await personalModel.batchUpdateAiModels('openai', remoteModels);
    await workspaceModel.batchUpdateAiModels('openai', workspaceRemoteModels);

    await personalModel.batchToggleAiModels('openai', ['batch-toggle-model'], true);
    await workspaceModel.batchToggleAiModels('openai', ['batch-toggle-model'], false);

    await personalModel.updateModelsOrder('openai', [{ id: 'ordered-model', sort: 10 }]);
    await workspaceModel.updateModelsOrder('openai', [{ id: 'ordered-model', sort: 20 }]);

    const rows = await serverDB.query.aiModels.findMany({
      where: eq(aiModels.userId, userId),
    });

    expect(rows).toHaveLength(8);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Personal model',
          id: 'upsert-model',
          workspaceId: null,
        }),
        expect.objectContaining({
          displayName: 'Workspace model',
          id: 'upsert-model',
          workspaceId,
        }),
        expect.objectContaining({
          displayName: 'Personal remote model',
          id: 'remote-model',
          workspaceId: null,
        }),
        expect.objectContaining({
          displayName: 'Workspace remote model',
          id: 'remote-model',
          workspaceId,
        }),
        expect.objectContaining({
          enabled: true,
          id: 'batch-toggle-model',
          workspaceId: null,
        }),
        expect.objectContaining({
          enabled: false,
          id: 'batch-toggle-model',
          workspaceId,
        }),
        expect.objectContaining({
          id: 'ordered-model',
          sort: 10,
          workspaceId: null,
        }),
        expect.objectContaining({
          id: 'ordered-model',
          sort: 20,
          workspaceId,
        }),
      ]),
    );
  });

  it('scopes model delete helpers to personal and workspace rows', async () => {
    const personalModel = new AiModelModel(serverDB, userId);
    const workspaceModel = new AiModelModel(serverDB, userId, workspaceId);

    await personalModel.create({
      id: 'scoped-model',
      providerId: 'openai',
    });
    await workspaceModel.create({
      id: 'scoped-model',
      providerId: 'openai',
    });
    await personalModel.create({
      id: 'personal-only-model',
      providerId: 'anthropic',
    });

    await personalModel.clearModelsByProvider('openai');

    await expect(personalModel.findById('scoped-model')).resolves.toBeUndefined();
    await expect(workspaceModel.findById('scoped-model')).resolves.toMatchObject({
      id: 'scoped-model',
      workspaceId,
    });
    await expect(personalModel.findById('personal-only-model')).resolves.toMatchObject({
      id: 'personal-only-model',
      workspaceId: null,
    });

    await personalModel.deleteAll();

    await expect(personalModel.query()).resolves.toEqual([]);
    await expect(workspaceModel.query()).resolves.toEqual([
      expect.objectContaining({
        id: 'scoped-model',
        workspaceId,
      }),
    ]);
  });
});

afterEach(async () => {
  await serverDB.delete(aiModels).where(eq(aiModels.userId, userId));
  await serverDB.delete(aiProviders).where(eq(aiProviders.userId, userId));
  await serverDB.delete(apiKeys).where(eq(apiKeys.userId, userId));
});
