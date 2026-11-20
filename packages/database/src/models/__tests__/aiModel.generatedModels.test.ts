// @vitest-environment node
import { eq } from 'drizzle-orm';
import type { AiProviderModelListItem } from 'model-bank';
import { CHAT_MODEL_IMAGE_GENERATION_PARAMS } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { aiModels, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AiModelModel } from '../aiModel';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'ai-model-generated-models-test-user-id';
const aiProviderModel = new AiModelModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(aiModels).where(eq(aiModels.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

/**
 * Cards generated from a whitelisted chat model (`<id>:image`, `<id>:decision`) can collide
 * with a card the provider already lists under that id; the generated one wins.
 */
describe('AiModelModel.batchUpdateAiModels with generated models', () => {
  it('should keep a generated image model when it follows a provider duplicate', async () => {
    const baseModelId = 'gemini-3.1-flash-image-preview';
    const generatedImageModelId = `${baseModelId}:image`;
    const models = [
      {
        id: baseModelId,
        type: 'chat',
      },
      {
        displayName: 'Provider Image Model',
        id: generatedImageModelId,
        type: 'image',
      },
      {
        displayName: 'LobeHub Image Model',
        id: generatedImageModelId,
        parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS,
        type: 'image',
      },
    ] as AiProviderModelListItem[];

    const result = await aiProviderModel.batchUpdateAiModels('openai', models);

    expect(result).toHaveLength(2);
    expect(await aiProviderModel.findById(generatedImageModelId)).toMatchObject({
      displayName: 'LobeHub Image Model',
      parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS,
    });
  });

  it('should keep a generated decision model when it follows a provider duplicate', async () => {
    const models = [
      { id: 'gpt-6-luna', type: 'chat' },
      { displayName: 'Provider Decision Model', id: 'gpt-6-luna:decision', type: 'decision' },
      { displayName: 'GPT-6 Luna Decisions', id: 'gpt-6-luna:decision', type: 'decision' },
    ] as AiProviderModelListItem[];

    const result = await aiProviderModel.batchUpdateAiModels('openai', models);

    expect(result).toHaveLength(2);
    expect(await aiProviderModel.findById('gpt-6-luna:decision')).toMatchObject({
      displayName: 'GPT-6 Luna Decisions',
      type: 'decision',
    });
  });
});
