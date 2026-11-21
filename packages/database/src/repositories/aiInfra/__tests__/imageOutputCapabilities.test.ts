import type { AiProviderListItem } from '@lobechat/types';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

vi.mock('@lobechat/business-model-bank/model-config', async () => {
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
  return { loadModels: vi.fn().mockResolvedValue(LOBE_DEFAULT_MODEL_LIST) };
});

const userId = 'test-user-id';

/** A GPT Image 2.6 card as the LobeHub model config declares it: GIF output with frame params. */
const declaredGptImage26Card = {
  displayName: 'GPT Image 2.6 Sunburst',
  enabled: true,
  id: 'gpt-image-2.6-sunburst',
  parameters: {
    frameCount: { default: 9, max: 64, min: 2, step: 1 },
    frameDurationMs: { default: 200, max: 2000, min: 20, step: 10 },
    imageUrls: { default: [], maxCount: 1, maxFileSize: 5_242_880 },
    outputFormat: { default: 'png', enum: ['png', 'gif'] },
    prompt: { default: '' },
    size: { default: 'auto', enum: ['auto', '1024x1024'] },
  },
  type: 'image' as const,
};

const routeServedParameters = {
  imageUrls: { default: [], maxCount: 1, maxFileSize: 5_242_880 },
  outputFormat: { default: 'png', enum: ['png', 'jpeg', 'webp'] },
  prompt: { default: '' },
  size: { default: 'auto', enum: ['auto', '1024x1024'] },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, {});
});

describe('AiInfraRepos image output capabilities', () => {
  it('serves the LobeHub GPT Image 2.6 schema without GIF output or frame params', async () => {
    vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue([]);
    vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([declaredGptImage26Card]);

    const [model] = await repo.getAiProviderModelList('lobehub', { type: 'image' });

    expect(model.id).toBe('gpt-image-2.6-sunburst');
    expect(model.parameters).toEqual(routeServedParameters);
  });

  it('keeps the declared GIF output for the same model on another provider', async () => {
    vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue([]);
    vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([declaredGptImage26Card]);

    const [model] = await repo.getAiProviderModelList('openai', { type: 'image' });

    expect(model.parameters).toEqual(declaredGptImage26Card.parameters);
  });

  it('serves the same narrowed schema in the enabled model list read by the image page', async () => {
    vi.spyOn(repo, 'getAiProviderList').mockResolvedValue([
      { enabled: true, id: 'lobehub', source: 'builtin' },
    ] as AiProviderListItem[]);
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([]);
    vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([declaredGptImage26Card]);

    const models = await repo.getEnabledModels();
    const model = models.find((item) => item.id === 'gpt-image-2.6-sunburst');

    expect(model?.parameters).toEqual(routeServedParameters);
  });
});
