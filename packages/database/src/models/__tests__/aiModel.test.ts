// @vitest-environment node
import { and, eq, isNull } from 'drizzle-orm';
import type { AiProviderModelListItem } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewAiModelItem } from '../../schemas';
import { aiModels, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiModelModel } from '../aiModel';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([
    { id: 'gpt-4', providerId: 'openai', type: 'chat' },
    { id: 'dall-e-3', providerId: 'openai', type: 'image' },
    { id: 'gpt-4o', providerId: 'openai', type: 'chat' },
  ]),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'ai-model-test-user-id';
const workspaceId = 'ai-model-test-workspace-id';
const aiProviderModel = new AiModelModel(serverDB, userId);
const workspaceAiModelModel = new AiModelModel(serverDB, userId, workspaceId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Model Test Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(aiModels).where(eq(aiModels.userId, userId));
});

describe('AiModelModel', () => {
  describe('create', () => {
    it('should create a new ai provider', async () => {
      const params: NewAiModelItem = {
        organization: 'Qwen',
        id: 'qvq',
        providerId: 'openai',
      };

      const result = await aiProviderModel.create(params);
      expect(result.id).toBeDefined();
      expect(result).toMatchObject({ ...params, userId });

      const group = await serverDB.query.aiModels.findFirst({
        where: eq(aiModels.id, result.id),
      });
      expect(group).toMatchObject({ ...params, userId });
    });

    it('should reject creating the same model id twice', async () => {
      await aiProviderModel.create({
        displayName: 'Old Name',
        enabled: false,
        id: 'qvq',
        providerId: 'openai',
        releasedAt: '2025-01-01',
      });

      await expect(
        aiProviderModel.create({
          contextWindowTokens: 4096,
          displayName: 'New Name',
          id: 'qvq',
          providerId: 'openai',
          releasedAt: '2025-02-01T00:00:00.000Z',
        }),
      ).rejects.toThrow();

      const models = await aiProviderModel.query();
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        displayName: 'Old Name',
        releasedAt: '2025-01-01',
      });
    });

    it('should heal the legacy `stt` type to `asr` on write', async () => {
      // The model type was renamed `stt` → `asr`. A deprecated `stt` input
      // (e.g. from the OpenAPI back-compat path) must be persisted as `asr`,
      // so writes lazily migrate the value without a bulk DB migration.
      const result = await aiProviderModel.create({
        id: 'my-transcribe',
        providerId: 'openai',
        type: 'stt' as NewAiModelItem['type'],
      });
      expect(result.type).toBe('asr');

      const persisted = await serverDB.query.aiModels.findFirst({
        where: eq(aiModels.id, 'my-transcribe'),
      });
      expect(persisted!.type).toBe('asr');
    });
  });
  describe('delete', () => {
    it('should delete a ai provider by id', async () => {
      const { id } = await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'qvq',
      });

      await aiProviderModel.delete(id, 'openai');

      const group = await serverDB.query.aiModels.findFirst({
        where: eq(aiModels.id, id),
      });
      expect(group).toBeUndefined();
    });
  });
  describe('deleteAll', () => {
    it('should delete all ai providers for the user', async () => {
      await aiProviderModel.create({ organization: 'Qwen', providerId: 'openai', id: 'qvq' });
      await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'aihubmix-2',
      });

      await aiProviderModel.deleteAll();

      const userGroups = await serverDB.query.aiModels.findMany({
        where: eq(aiModels.userId, userId),
      });
      expect(userGroups).toHaveLength(0);
    });
    it('should only delete ai providers for the user, not others', async () => {
      await aiProviderModel.create({ organization: 'Qwen', providerId: 'openai', id: 'qvq' });
      await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'aihubmix-2',
      });

      const anotherAiModelModel = new AiModelModel(serverDB, 'user2');
      await anotherAiModelModel.create({ id: 'qvq', providerId: 'openai' });

      await aiProviderModel.deleteAll();

      const userGroups = await serverDB.query.aiModels.findMany({
        where: eq(aiModels.userId, userId),
      });
      const total = await serverDB.query.aiModels.findMany();
      expect(userGroups).toHaveLength(0);
      expect(total).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should query ai providers for the user', async () => {
      await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'qvq',
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      });
      await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'aihubmix-2',
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      });

      const userGroups = await aiProviderModel.query();
      expect(userGroups).toHaveLength(2);
      expect(userGroups[0].id).toBe('aihubmix-2');
      expect(userGroups[1].id).toBe('qvq');
    });

    it('should not include personal models in workspace scope', async () => {
      await aiProviderModel.create({
        displayName: 'Personal GPT',
        id: 'gpt-personal',
        providerId: 'openai',
      });
      await workspaceAiModelModel.create({
        displayName: 'Workspace GPT',
        id: 'gpt-workspace',
        providerId: 'openai',
      });

      const models = await workspaceAiModelModel.query();

      expect(models.map((item) => item.id)).toEqual(['gpt-workspace']);
    });
  });

  describe('findById', () => {
    it('should find a ai provider by id', async () => {
      const { id } = await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'qvq',
      });

      const group = await aiProviderModel.findById(id);
      expect(group).toMatchObject({
        id,
        organization: 'Qwen',
        providerId: 'openai',

        userId,
      });
    });
  });

  describe('update', () => {
    it('should update a ai provider', async () => {
      const { id } = await aiProviderModel.create({
        organization: 'Qwen',
        providerId: 'openai',
        id: 'qvq',
      });

      await aiProviderModel.update(id, 'openai', {
        displayName: 'Updated Test Group',
        contextWindowTokens: 3000,
      });

      const updatedGroup = await serverDB.query.aiModels.findFirst({
        where: eq(aiModels.id, id),
      });
      expect(updatedGroup).toMatchObject({
        id,
        displayName: 'Updated Test Group',
        contextWindowTokens: 3000,
        userId,
      });
    });
  });

  describe('getModelListByProviderId', () => {
    it('should get model list by provider id', async () => {
      await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
        sort: 1,
        enabled: true,
      });
      await aiProviderModel.create({
        id: 'model2',
        providerId: 'openai',
        sort: 2,
        enabled: false,
      });

      const models = await aiProviderModel.getModelListByProviderId('openai');
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model1');
      expect(models[1].id).toBe('model2');
    });

    it('should only return models for specified provider', async () => {
      await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
      });
      await aiProviderModel.create({
        id: 'model2',
        providerId: 'anthropic',
      });

      const models = await aiProviderModel.getModelListByProviderId('openai');
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model1');
    });
  });

  describe('getAllModels', () => {
    it('should only return enabled models', async () => {
      await serverDB.insert(aiModels).values([
        { id: 'model1', providerId: 'openai', enabled: true, source: 'custom', userId },
        { id: 'model2', providerId: 'b', enabled: false, source: 'custom', userId },
      ]);

      const models = await aiProviderModel.getAllModels();
      expect(models).toHaveLength(2);
    });
  });

  describe('toggleModelEnabled', () => {
    it('should toggle model enabled status', async () => {
      const model = await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
        enabled: true,
        type: 'image',
      });

      await aiProviderModel.toggleModelEnabled({
        id: model.id,
        providerId: 'openai',
        enabled: false,
        type: 'image',
      });

      const updatedModel = await aiProviderModel.findById(model.id);
      expect(updatedModel?.enabled).toBe(false);
      expect(updatedModel?.type).toBe('image');
    });

    it('should write workspace model toggles without updating personal models', async () => {
      await aiProviderModel.create({
        enabled: true,
        id: 'gpt-4o',
        providerId: 'openai',
      });

      await workspaceAiModelModel.toggleModelEnabled({
        enabled: false,
        id: 'gpt-4o',
        providerId: 'openai',
      });

      const personal = await serverDB.query.aiModels.findFirst({
        where: and(
          eq(aiModels.id, 'gpt-4o'),
          eq(aiModels.providerId, 'openai'),
          eq(aiModels.userId, userId),
          isNull(aiModels.workspaceId),
        ),
      });
      const workspace = await serverDB.query.aiModels.findFirst({
        where: and(
          eq(aiModels.id, 'gpt-4o'),
          eq(aiModels.providerId, 'openai'),
          eq(aiModels.userId, userId),
          eq(aiModels.workspaceId, workspaceId),
        ),
      });

      expect(personal?.enabled).toBe(true);
      expect(workspace).toMatchObject({ enabled: false, workspaceId });
    });
  });

  describe('batchUpdateAiModels', () => {
    it('should insert new models and preserve existing user-editable fields on conflict', async () => {
      // Create an initial model — displayName set by user
      await aiProviderModel.create({
        id: 'existing-model',
        providerId: 'openai',
        displayName: 'Old Name',
      });

      const models = [
        {
          id: 'existing-model',
          // Provider sends a new displayName, but DB-first COALESCE keeps 'Old Name'
          displayName: 'Updated Name',
        },
        {
          id: 'new-model',
          // No existing row — incoming value is used
          displayName: 'New Model',
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      const allModels = await aiProviderModel.query();
      expect(allModels).toHaveLength(2);
      // Existing non-null displayName is preserved (DB-first)
      expect(allModels.find((m) => m.id === 'existing-model')?.displayName).toBe('Old Name');
      // New model has no previous value → incoming value fills it
      expect(allModels.find((m) => m.id === 'new-model')?.displayName).toBe('New Model');
    });

    it('should fill NULL user-editable fields from incoming data', async () => {
      // Create a model with no displayName, contextWindowTokens, abilities, parameters, or type override
      await serverDB.insert(aiModels).values({
        id: 'bare-model',
        providerId: 'openai',
        userId,
        // displayName intentionally left NULL
      });

      const models = [
        {
          id: 'bare-model',
          displayName: 'Filled Name',
          contextWindowTokens: 8192,
          type: 'chat',
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      const allModels = await aiProviderModel.query();
      const model = allModels.find((m) => m.id === 'bare-model');
      // NULL slots are filled by the incoming provider data
      expect(model?.displayName).toBe('Filled Name');
      expect(model?.contextWindowTokens).toBe(8192);
      expect(model?.type).toBe('chat');
    });

    it('should not overwrite existing displayName with null/undefined when updating', async () => {
      // Create an initial model with displayName
      await aiProviderModel.create({
        id: 'existing-model',
        providerId: 'openai',
        displayName: 'Old Name',
      });

      const models = [
        {
          id: 'existing-model',
          enabled: false,
          type: 'chat' as const,
          // displayName is missing/undefined
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      const allModels = await aiProviderModel.query();
      const model = allModels.find((m) => m.id === 'existing-model');
      // displayName is preserved (DB-first) because it was already set
      expect(model?.displayName).toBe('Old Name');
    });

    it('should not overwrite existing abilities/parameters with empty defaults when omitted in sparse update', async () => {
      // Create an initial model with abilities and parameters
      await aiProviderModel.create({
        id: 'existing-model',
        providerId: 'openai',
        abilities: { functionCall: true },
        parameters: { temperature: 0.5 },
      });

      const models = [
        {
          id: 'existing-model',
          enabled: false,
          type: 'chat' as const,
          // abilities and parameters are omitted in the payload
          displayName: 'Updated Name',
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      const allModels = await aiProviderModel.query();
      const model = allModels.find((m) => m.id === 'existing-model');
      expect(model?.abilities).toEqual({ functionCall: true });
      expect(model?.parameters).toEqual({ temperature: 0.5 });
    });

    it('should return empty array when models array is empty', async () => {
      const result = await aiProviderModel.batchUpdateAiModels('openai', []);
      expect(result).toEqual([]);

      // Verify no models were created
      const allModels = await aiProviderModel.query();
      expect(allModels).toHaveLength(0);
    });

    it('should normalize ISO releasedAt values before inserting remote models', async () => {
      const models = [
        {
          displayName: 'Remote Model',
          enabled: true,
          id: 'remote-model',
          releasedAt: '2025-01-01T00:00:00.000Z',
        },
      ] as AiProviderModelListItem[];

      const [result] = await aiProviderModel.batchUpdateAiModels('openai', models);

      expect(result.releasedAt).toBe('2025-01-01');
    });

    it('should update abilities when remote provides new capabilities for existing model with empty abilities', async () => {
      // 1. Historical model with empty abilities
      await serverDB.insert(aiModels).values({
        id: 'old-model',
        providerId: 'openai',
        userId,
        abilities: {}, // Empty capabilities
        source: 'remote',
      });

      // 2. Remote returns same model with new capabilities
      const models = [
        {
          id: 'old-model',
          enabled: false,
          type: 'chat' as const,
          abilities: { functionCall: true, reasoning: true },
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify abilities are updated
      const updated = await aiProviderModel.findById('old-model');
      expect(updated?.abilities).toEqual({
        functionCall: true,
        reasoning: true,
      });
    });

    it('should update type when remote corrects model type', async () => {
      // 1. Existing model with wrong type
      await serverDB.insert(aiModels).values({
        id: 'image-model',
        providerId: 'openai',
        userId,
        type: 'chat', // Wrong type
        source: 'remote',
      });

      // 2. Remote provides correct type
      const models = [
        {
          id: 'image-model',
          enabled: false,
          type: 'image' as const, // Correct type
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify type is updated
      const updated = await aiProviderModel.findById('image-model');
      expect(updated?.type).toBe('image');
    });

    it('should update parameters when remote provides new parameters for existing model', async () => {
      // 1. Existing model with empty parameters
      await serverDB.insert(aiModels).values({
        id: 'param-model',
        providerId: 'openai',
        userId,
        parameters: {}, // Empty parameters
        source: 'remote',
      });

      // 2. Remote provides parameters
      const models = [
        {
          id: 'param-model',
          enabled: false,
          type: 'chat' as const,
          parameters: {
            max_tokens: { default: 4096 },
            temperature: { default: 0.7, max: 2, min: 0, step: 0.1 },
          } as any,
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify parameters are updated
      const updated = await aiProviderModel.findById('param-model');
      expect(updated?.parameters).toEqual({
        max_tokens: { default: 4096 },
        temperature: { default: 0.7, max: 2, min: 0, step: 0.1 },
      });
    });

    it('should update pricing from remote data', async () => {
      // 1. Existing model with old pricing
      await serverDB.insert(aiModels).values({
        id: 'pricing-model',
        providerId: 'openai',
        userId,
        pricing: {
          currency: 'USD',
          units: [
            { name: 'input', rate: 10, strategy: 'fixed', unit: 'token' },
            { name: 'output', rate: 30, strategy: 'fixed', unit: 'token' },
          ],
        } as any,
        source: 'remote',
      });

      // 2. Remote provides updated pricing
      const models = [
        {
          id: 'pricing-model',
          enabled: false,
          type: 'chat' as const,
          pricing: {
            currency: 'USD',
            units: [
              { name: 'input', rate: 5, strategy: 'fixed', unit: 'token' },
              { name: 'output', rate: 15, strategy: 'fixed', unit: 'token' },
            ],
          } as any,
        },
      ] as any as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify pricing is updated
      const updated = await aiProviderModel.findById('pricing-model');
      expect(updated?.pricing).toEqual({
        currency: 'USD',
        units: [
          { name: 'input', rate: 5, strategy: 'fixed', unit: 'token' },
          { name: 'output', rate: 15, strategy: 'fixed', unit: 'token' },
        ],
      });
    });

    it('should NOT overwrite existing type when remote payload omits type field', async () => {
      // 1. Existing remote model with type='image'
      await serverDB.insert(aiModels).values({
        id: 'image-model',
        providerId: 'openai',
        userId,
        type: 'image',
        source: 'remote',
      });

      // 2. Remote payload omits type (caller does not include type field)
      // excluded.type will be 'chat' (schema default), but SQL condition filters it out
      const models = [
        {
          id: 'image-model',
          enabled: false,
          // type is omitted - no type field at all
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify type is preserved (not overwritten by default 'chat')
      const updated = await aiProviderModel.findById('image-model');
      expect(updated?.type).toBe('image');
    });

    it('should update type from non-chat to another non-chat when remote provides it', async () => {
      // 1. Existing remote model with type='image'
      await serverDB.insert(aiModels).values({
        id: 'multimodal-model',
        providerId: 'openai',
        userId,
        type: 'image',
        source: 'remote',
      });

      // 2. Remote reclassifies it as 'video'
      const models = [
        {
          id: 'multimodal-model',
          enabled: false,
          type: 'video' as const,
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify type is updated
      const updated = await aiProviderModel.findById('multimodal-model');
      expect(updated?.type).toBe('video');
    });

    it('should NOT overwrite existing abilities when remote payload has empty abilities', async () => {
      // 1. Existing remote model with abilities
      await serverDB.insert(aiModels).values({
        id: 'capable-model',
        providerId: 'openai',
        userId,
        abilities: { functionCall: true, reasoning: true },
        source: 'remote',
      });

      // 2. Remote payload provides empty abilities object (all fields undefined)
      const models = [
        {
          id: 'capable-model',
          enabled: false,
          type: 'chat' as const,
          abilities: {}, // Empty object - no real capabilities
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify abilities are preserved
      const updated = await aiProviderModel.findById('capable-model');
      expect(updated?.abilities).toEqual({ functionCall: true, reasoning: true });
    });

    it('should update custom models with remote provider-sourced data while preserving user-editable fields', async () => {
      // 1. User-created custom model (e.g., user added model ID before provider officially supported it)
      await serverDB.insert(aiModels).values({
        id: 'custom-model',
        providerId: 'openai',
        userId,
        displayName: 'My Custom Model',
        abilities: { functionCall: true },
        type: 'chat',
        pricing: {
          currency: 'USD',
          units: [
            { name: 'input', rate: 10, strategy: 'fixed', unit: 'token' },
            { name: 'output', rate: 20, strategy: 'fixed', unit: 'token' },
          ],
        } as any,
        source: 'custom',
      });

      // 2. Remote provides different data for same model id (provider now officially supports it)
      const models = [
        {
          id: 'custom-model',
          enabled: false,
          displayName: 'Remote Name',
          abilities: { vision: true },
          type: 'image' as const,
          pricing: {
            currency: 'USD',
            units: [
              { name: 'input', rate: 5, strategy: 'fixed', unit: 'token' },
              { name: 'output', rate: 10, strategy: 'fixed', unit: 'token' },
            ],
          } as any,
        },
      ] as any as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify: provider-sourced fields updated, user-editable fields preserved
      const updated = await aiProviderModel.findById('custom-model');
      expect(updated?.displayName).toBe('My Custom Model'); // User-editable: preserved
      expect(updated?.abilities).toEqual({ vision: true }); // Provider-sourced: updated
      expect(updated?.type).toBe('image'); // Provider-sourced: updated
      expect(updated?.pricing).toEqual({
        currency: 'USD',
        units: [
          { name: 'input', rate: 5, strategy: 'fixed', unit: 'token' },
          { name: 'output', rate: 10, strategy: 'fixed', unit: 'token' },
        ],
      }); // Provider-sourced: updated
      expect(updated?.source).toBe('custom'); // Source: preserved
    });

    it('should update both remote and custom models in same batch', async () => {
      // 1. Create both remote and custom models
      await serverDB.insert(aiModels).values([
        {
          id: 'remote-model',
          providerId: 'openai',
          userId,
          abilities: {},
          source: 'remote',
        },
        {
          id: 'custom-model',
          providerId: 'openai',
          userId,
          abilities: { functionCall: true },
          source: 'custom',
        },
      ]);

      // 2. Remote provides updates for both
      const models = [
        {
          id: 'remote-model',
          enabled: false,
          type: 'chat' as const,
          abilities: { vision: true },
        },
        {
          id: 'custom-model',
          enabled: false,
          type: 'chat' as const,
          abilities: { reasoning: true },
        },
      ] as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify: both models updated with remote provider-sourced data
      const remoteModel = await aiProviderModel.findById('remote-model');
      const customModel = await aiProviderModel.findById('custom-model');

      expect(remoteModel?.abilities).toEqual({ vision: true });
      expect(customModel?.abilities).toEqual({ reasoning: true }); // Now updated from remote
    });

    it('should NOT update builtin models with remote provider-sourced data', async () => {
      // 1. Builtin model with existing data
      await serverDB.insert(aiModels).values({
        id: 'gpt-4',
        providerId: 'openai',
        userId,
        displayName: 'GPT-4',
        abilities: { functionCall: true, vision: true },
        type: 'chat',
        contextWindowTokens: 128000,
        pricing: {
          currency: 'USD',
          units: [
            { name: 'input', rate: 10, strategy: 'fixed', unit: 'token' },
            { name: 'output', rate: 30, strategy: 'fixed', unit: 'token' },
          ],
        } as any,
        parameters: { temperature: 1 },
        releasedAt: '2023-03-14',
        description: 'Built-in model description',
        source: 'builtin',
      });

      // 2. Remote provides different data for same model id
      const models = [
        {
          id: 'gpt-4',
          enabled: false,
          displayName: 'Remote GPT-4',
          abilities: { reasoning: true }, // Different abilities
          type: 'image' as const, // Different type
          contextWindowTokens: 8192, // Different context window
          pricing: {
            currency: 'USD',
            units: [
              { name: 'input', rate: 5, strategy: 'fixed', unit: 'token' },
              { name: 'output', rate: 15, strategy: 'fixed', unit: 'token' },
            ],
          } as any, // Different pricing
          parameters: { temperature: 0.5 }, // Different parameters
          releasedAt: '2024-01-01', // Different release date
          description: 'Remote model description', // Different description
        },
      ] as any as AiProviderModelListItem[];

      await aiProviderModel.batchUpdateAiModels('openai', models);

      // 3. Verify: builtin model is protected from remote updates
      const updated = await aiProviderModel.findById('gpt-4');

      // Provider-sourced fields should NOT be updated
      expect(updated?.abilities).toEqual({ functionCall: true, vision: true }); // Preserved
      expect(updated?.type).toBe('chat'); // Preserved
      expect(updated?.contextWindowTokens).toBe(128000); // Preserved
      expect(updated?.pricing).toEqual({
        currency: 'USD',
        units: [
          { name: 'input', rate: 10, strategy: 'fixed', unit: 'token' },
          { name: 'output', rate: 30, strategy: 'fixed', unit: 'token' },
        ],
      }); // Preserved
      expect(updated?.parameters).toEqual({ temperature: 1 }); // Preserved
      expect(updated?.releasedAt).toBe('2023-03-14'); // Preserved
      expect(updated?.description).toBe('Built-in model description'); // Preserved

      // User-editable fields still use DB-first COALESCE
      expect(updated?.displayName).toBe('GPT-4'); // Preserved (user-editable)

      // Source is never overwritten
      expect(updated?.source).toBe('builtin');
    });
  });

  describe('batchToggleAiModels', () => {
    it('should toggle multiple models enabled status', async () => {
      await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
        enabled: false,
      });
      await aiProviderModel.create({
        id: 'model2',
        providerId: 'openai',
        enabled: false,
      });

      await aiProviderModel.batchToggleAiModels('openai', ['model1', 'model2'], true);

      const models = await aiProviderModel.query();
      expect(models.every((m) => m.enabled)).toBe(true);
    });

    it('should return early when models array is empty', async () => {
      // Create an initial model to verify it's not affected
      await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
        enabled: false,
      });

      const result = await aiProviderModel.batchToggleAiModels('openai', [], true);
      expect(result).toBeUndefined();

      // Verify existing models were not affected
      const models = await aiProviderModel.query();
      expect(models).toHaveLength(1);
      expect(models[0].enabled).toBe(false);
    });

    it('should preserve type property when disabling all models', async () => {
      // Create models with type information
      await aiProviderModel.create({
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
      });
      await aiProviderModel.create({
        id: 'dall-e-3',
        providerId: 'openai',
        enabled: true,
        type: 'image',
      });

      // Batch disable all models
      await aiProviderModel.batchToggleAiModels('openai', ['gpt-4', 'dall-e-3'], false);

      // Verify type is preserved
      const models = await aiProviderModel.getModelListByProviderId('openai');
      expect(models).toHaveLength(2);
      expect(models.find((m) => m.id === 'gpt-4')?.type).toBe('chat');
      expect(models.find((m) => m.id === 'dall-e-3')?.type).toBe('image');
      expect(models.every((m) => !m.enabled)).toBe(true);
    });

    it('should batch toggle workspace models without updating personal models', async () => {
      await aiProviderModel.create({
        enabled: true,
        id: 'gpt-4o',
        providerId: 'openai',
      });
      await workspaceAiModelModel.create({
        enabled: true,
        id: 'gpt-4o',
        providerId: 'openai',
      });

      await workspaceAiModelModel.batchToggleAiModels('openai', ['gpt-4o'], false);

      const personal = await serverDB.query.aiModels.findFirst({
        where: and(
          eq(aiModels.id, 'gpt-4o'),
          eq(aiModels.providerId, 'openai'),
          eq(aiModels.userId, userId),
          isNull(aiModels.workspaceId),
        ),
      });
      const workspace = await serverDB.query.aiModels.findFirst({
        where: and(
          eq(aiModels.id, 'gpt-4o'),
          eq(aiModels.providerId, 'openai'),
          eq(aiModels.userId, userId),
          eq(aiModels.workspaceId, workspaceId),
        ),
      });

      expect(personal?.enabled).toBe(true);
      expect(workspace?.enabled).toBe(false);
    });
  });

  describe('clearRemoteModels', () => {
    it('should delete all remote models for a provider', async () => {
      await serverDB.insert(aiModels).values([
        { id: 'remote1', providerId: 'openai', source: 'remote', userId },
        { id: 'custom1', providerId: 'openai', source: 'custom', userId },
      ]);

      await aiProviderModel.clearRemoteModels('openai');

      const remainingModels = await aiProviderModel.query();
      expect(remainingModels).toHaveLength(1);
      expect(remainingModels[0].id).toBe('custom1');
    });
  });

  describe('clearModelsByProvider', () => {
    it('should delete ALL models for a given provider regardless of source', async () => {
      await serverDB.insert(aiModels).values([
        { id: 'remote1', providerId: 'openai', source: 'remote', userId },
        { id: 'custom1', providerId: 'openai', source: 'custom', userId },
        { id: 'model1', providerId: 'anthropic', source: 'remote', userId },
        { id: 'model2', providerId: 'anthropic', source: 'custom', userId },
      ]);

      await aiProviderModel.clearModelsByProvider('openai');

      const remainingModels = await aiProviderModel.query();
      expect(remainingModels).toHaveLength(2);
      expect(remainingModels.every((m) => m.providerId === 'anthropic')).toBe(true);
    });

    it('should only delete models for the current user', async () => {
      await serverDB.insert(aiModels).values([
        { id: 'user1-model', providerId: 'openai', source: 'custom', userId },
        { id: 'user2-model', providerId: 'openai', source: 'custom', userId: 'user2' },
      ]);

      await aiProviderModel.clearModelsByProvider('openai');

      const userModels = await serverDB.query.aiModels.findMany({
        where: eq(aiModels.userId, userId),
      });
      const otherUserModels = await serverDB.query.aiModels.findMany({
        where: eq(aiModels.userId, 'user2'),
      });

      expect(userModels).toHaveLength(0);
      expect(otherUserModels).toHaveLength(1);
    });
  });

  describe('updateModelsOrder', () => {
    it('should update the sort order of models', async () => {
      await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
        sort: 1,
      });
      await aiProviderModel.create({
        id: 'model2',
        providerId: 'openai',
        sort: 2,
      });

      const sortMap = [
        { id: 'model1', sort: 2 },
        { id: 'model2', sort: 1 },
      ];

      await aiProviderModel.updateModelsOrder('openai', sortMap);

      const models = await aiProviderModel.getModelListByProviderId('openai');
      expect(models[0].id).toBe('model2');
      expect(models[1].id).toBe('model1');
    });

    it('should preserve model type when inserting order records', async () => {
      const sortMap = [{ id: 'image-model', sort: 0, type: 'image' as const }];

      await aiProviderModel.updateModelsOrder('openai', sortMap);

      const model = await aiProviderModel.findById('image-model');
      expect(model?.type).toBe('image');
    });

    it('should return early when sortMap array is empty', async () => {
      // Create an initial model to verify it's not affected
      await aiProviderModel.create({
        id: 'model1',
        providerId: 'openai',
        sort: 1,
      });

      const result = await aiProviderModel.updateModelsOrder('openai', []);
      expect(result).toBeUndefined();

      // Verify existing models were not affected (check by querying the created model directly)
      const models = await aiProviderModel.getModelListByProviderId('openai');
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model1');
    });
  });
});
