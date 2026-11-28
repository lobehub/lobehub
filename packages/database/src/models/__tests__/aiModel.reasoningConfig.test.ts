// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import type { AiProviderModelListItem } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { aiModels, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiModelModel } from '../aiModel';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([
    { id: 'gpt-4', providerId: 'openai', type: 'chat' },
    { id: 'dall-e-3', providerId: 'openai', type: 'image' },
    { id: 'gpt-4o', providerId: 'openai', type: 'chat' },
    { id: 'whisper-1', providerId: 'openai', type: 'asr' },
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
  describe('model reasoning config (personal scope)', () => {
    it('should create a preference-only row without flipping enabled or source', async () => {
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'xhigh',
        reasoningMode: 'pro',
      });

      const row = await serverDB.query.aiModels.findFirst({
        where: and(eq(aiModels.id, 'gpt-5.6-sol'), eq(aiModels.userId, userId)),
      });
      expect(row!.config).toEqual({
        chatConfig: { reasoningEffort: 'xhigh', reasoningMode: 'pro' },
      });
      // A row that exists only to hold the preference must not change model
      // visibility (enabled NULL falls back to builtin defaults) nor claim an
      // origin that would block later remote-sync updates.
      expect(row!.enabled).toBeNull();
      expect(row!.source).toBeNull();
      expect(row!.workspaceId).toBeNull();
    });

    it('should drop legacy effort keys when a write sets reasoningEffort', async () => {
      // Regression: a legacy key left next to a new pick made the migration
      // script overwrite the new pick with the old version's value
      await aiProviderModel.create({ id: 'gpt-5.2', providerId: 'openai' });
      await aiProviderModel.update('gpt-5.2', 'openai', {
        config: {
          chatConfig: { gpt5_2ReasoningEffort: 'low', reasoningMode: 'pro' } as any,
          deploymentName: 'keep-me',
        },
      });

      await aiProviderModel.updateModelReasoningConfig('gpt-5.2', 'openai', {
        reasoningEffort: 'xhigh',
      });

      const row = await aiProviderModel.findByIdAndProvider('gpt-5.2', 'openai');
      expect(row!.config).toEqual({
        chatConfig: { reasoningEffort: 'xhigh', reasoningMode: 'pro' },
        deploymentName: 'keep-me',
      });
    });

    it('should keep legacy effort keys when a write does not set reasoningEffort', async () => {
      await aiProviderModel.create({ id: 'gpt-5.2', providerId: 'openai' });
      await aiProviderModel.update('gpt-5.2', 'openai', {
        config: { chatConfig: { gpt5_2ReasoningEffort: 'low' } as any },
      });

      await aiProviderModel.updateModelReasoningConfig('gpt-5.2', 'openai', {
        reasoningMode: 'pro',
      });

      const config = await aiProviderModel.getModelReasoningConfig('gpt-5.2', 'openai');
      expect(config).toEqual({ gpt5_2ReasoningEffort: 'low', reasoningMode: 'pro' });
    });

    it('should merge partial chatConfig writes and preserve sibling config keys', async () => {
      await aiProviderModel.create({ id: 'gpt-5.6-sol', providerId: 'openai' });
      await aiProviderModel.update('gpt-5.6-sol', 'openai', {
        config: { deploymentName: 'keep-me' },
      });

      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'high',
      });
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningMode: 'pro',
      });

      const config = await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'openai');
      expect(config).toEqual({ reasoningEffort: 'high', reasoningMode: 'pro' });

      const row = await aiProviderModel.findByIdAndProvider('gpt-5.6-sol', 'openai');
      expect(row!.config).toMatchObject({ deploymentName: 'keep-me' });
    });

    it('should read/write the personal row even when scoped to a workspace', async () => {
      await workspaceAiModelModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'low',
      });

      // Written to the personal row (workspaceId NULL), not the workspace row
      const rows = await serverDB.query.aiModels.findMany({
        where: and(eq(aiModels.id, 'gpt-5.6-sol'), eq(aiModels.userId, userId)),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].workspaceId).toBeNull();

      // And readable through both scopes — the preference is cross-workspace
      expect(await workspaceAiModelModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toEqual({
        reasoningEffort: 'low',
      });
      expect(await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toEqual({
        reasoningEffort: 'low',
      });
    });

    it('should list every personal reasoning config in one read', async () => {
      await workspaceAiModelModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'low',
      });
      await aiProviderModel.updateModelReasoningConfig('claude-opus-5', 'anthropic', {
        reasoningMode: 'pro',
      });
      // A row without chatConfig is not a saved preference
      await aiProviderModel.create({ id: 'gpt-4o', providerId: 'openai' });
      await new AiModelModel(serverDB, 'user2').updateModelReasoningConfig(
        'gpt-5.6-sol',
        'openai',
        {
          reasoningEffort: 'high',
        },
      );

      const expected = {
        'anthropic/claude-opus-5': { reasoningMode: 'pro' },
        'openai/gpt-5.6-sol': { reasoningEffort: 'low' },
      };
      expect(await aiProviderModel.getAllModelReasoningConfigs()).toEqual(expected);
      // Cross-workspace, like the single-model read
      expect(await workspaceAiModelModel.getAllModelReasoningConfigs()).toEqual(expected);
    });

    it('should isolate configs across providers and users', async () => {
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'high',
      });

      expect(await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'azure')).toBeUndefined();

      const otherUserModel = new AiModelModel(serverDB, 'user2');
      expect(await otherUserModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toBeUndefined();
    });

    it('should survive a remote model list sync', async () => {
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'high',
      });

      await aiProviderModel.batchUpdateAiModels('openai', [
        {
          contextWindowTokens: 400_000,
          displayName: 'GPT-5.6 Sol',
          enabled: true,
          id: 'gpt-5.6-sol',
          source: 'remote',
          type: 'chat',
        } as AiProviderModelListItem,
      ]);

      expect(await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toEqual({
        reasoningEffort: 'high',
      });
    });

    it('should survive clearing remote models after a sync', async () => {
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'high',
      });

      // Sync claims the preference row as remote too (so its synced metadata
      // stays clearable); clearRemoteModels demotes chatConfig-holding remote
      // rows instead of deleting them, so the preference still survives
      await aiProviderModel.batchUpdateAiModels('openai', [
        {
          contextWindowTokens: 400_000,
          displayName: 'GPT-5.6 Sol',
          enabled: true,
          id: 'gpt-5.6-sol',
          source: 'remote',
          type: 'chat',
        },
        { enabled: true, id: 'some-remote-model', source: 'remote', type: 'chat' },
      ] as AiProviderModelListItem[]);
      await aiProviderModel.clearRemoteModels('openai');

      expect(await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toEqual({
        reasoningEffort: 'high',
      });
      // Demoted back to a hidden preference-only shell — the synced metadata
      // must not linger as a ghost list entry after clearing remote models
      const row = await aiProviderModel.findByIdAndProvider('gpt-5.6-sol', 'openai');
      expect(AiModelModel.isPreferenceOnlyRow(row!)).toBe(true);
      // The plain remote row is still cleared as before
      expect(await aiProviderModel.findByIdAndProvider('some-remote-model', 'openai')).toBe(
        undefined,
      );
    });

    it('should survive clearing remote models saved in remote-first order', async () => {
      // Row created by the remote fetch first...
      await aiProviderModel.batchUpdateAiModels('openai', [
        {
          contextWindowTokens: 400_000,
          displayName: 'GPT-5.6 Sol',
          enabled: true,
          id: 'gpt-5.6-sol',
          source: 'remote',
          type: 'chat',
        },
        { enabled: true, id: 'some-remote-model', source: 'remote', type: 'chat' },
      ] as AiProviderModelListItem[]);
      // ...then the user saves a preference onto the remote row
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'high',
      });

      await aiProviderModel.clearRemoteModels('openai');

      expect(await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toEqual({
        reasoningEffort: 'high',
      });
      // Demoted to a preference-only row: remote identity and metadata stripped
      const row = await aiProviderModel.findByIdAndProvider('gpt-5.6-sol', 'openai');
      expect(row!.source).toBeNull();
      expect(row!.displayName).toBeNull();
      expect(row!.contextWindowTokens).toBeNull();
      expect(row!.enabled).toBeNull();
      // The plain remote row is still cleared
      expect(await aiProviderModel.findByIdAndProvider('some-remote-model', 'openai')).toBe(
        undefined,
      );
    });

    it('should identify preference-only shells', async () => {
      await aiProviderModel.updateModelReasoningConfig('gpt-5.6-sol', 'openai', {
        reasoningEffort: 'high',
      });
      await aiProviderModel.create({ enabled: true, id: 'real-model', providerId: 'openai' });

      const shell = await aiProviderModel.findByIdAndProvider('gpt-5.6-sol', 'openai');
      const realModel = await aiProviderModel.findByIdAndProvider('real-model', 'openai');

      expect(AiModelModel.isPreferenceOnlyRow(shell!)).toBe(true);
      expect(AiModelModel.isPreferenceOnlyRow(realModel!)).toBe(false);

      // Promoting a shell via update (the createAiModel duplicate-bypass path)
      // keeps the saved preference
      await aiProviderModel.update('gpt-5.6-sol', 'openai', {
        displayName: 'Recreated',
        enabled: true,
        source: 'custom',
      });
      expect(await aiProviderModel.getModelReasoningConfig('gpt-5.6-sol', 'openai')).toEqual({
        reasoningEffort: 'high',
      });
      const promoted = await aiProviderModel.findByIdAndProvider('gpt-5.6-sol', 'openai');
      expect(AiModelModel.isPreferenceOnlyRow(promoted!)).toBe(false);
    });
  });
});
