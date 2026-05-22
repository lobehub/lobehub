// @vitest-environment node
import './testUtils';

import type { ChatModelCard } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { params } from '../index';

describe('DeepSeek models', () => {
  const fetchModels = params.models as (params: { client: unknown }) => Promise<ChatModelCard[]>;
  const mockClient = {
    models: {
      list: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and process models successfully', async () => {
    mockClient.models.list.mockResolvedValue({
      data: [{ id: 'deepseek-chat' }, { id: 'deepseek-coder' }, { id: 'deepseek-r1' }],
    });

    const models = await fetchModels({ client: mockClient });

    expect(mockClient.models.list).toHaveBeenCalledTimes(1);
    expect(models).toHaveLength(3);
    expect(models[0].id).toBe('deepseek-chat');
    expect(models[1].id).toBe('deepseek-coder');
    expect(models[2].id).toBe('deepseek-r1');
  });

  it('should handle single model', async () => {
    mockClient.models.list.mockResolvedValue({
      data: [{ id: 'deepseek-chat' }],
    });

    const models = await fetchModels({ client: mockClient });

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('deepseek-chat');
  });

  it('should handle empty model list', async () => {
    mockClient.models.list.mockResolvedValue({
      data: [],
    });

    const models = await fetchModels({ client: mockClient });

    expect(models).toEqual([]);
  });

  it('should process models with MODEL_LIST_CONFIGS', async () => {
    mockClient.models.list.mockResolvedValue({
      data: [{ id: 'deepseek-chat' }],
    });

    const models = await fetchModels({ client: mockClient });

    // The processModelList function should merge with known model list
    expect(models[0]).toHaveProperty('id');
    expect(models[0].id).toBe('deepseek-chat');
  });

  it('should preserve model properties from API response', async () => {
    mockClient.models.list.mockResolvedValue({
      data: [
        { id: 'deepseek-chat', extra_field: 'value' },
        { id: 'deepseek-coder', another_field: 123 },
      ],
    });

    const models = await fetchModels({ client: mockClient });

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('deepseek-chat');
    expect(models[1].id).toBe('deepseek-coder');
  });

  it('should handle models with different id patterns', async () => {
    mockClient.models.list.mockResolvedValue({
      data: [
        { id: 'deepseek-chat' },
        { id: 'deepseek-r1' },
        { id: 'deepseek-reasoner' },
        { id: 'deepseek-v3' },
      ],
    });

    const models = await fetchModels({ client: mockClient });

    expect(models).toHaveLength(4);
    expect(models.every((m) => typeof m.id === 'string')).toBe(true);
  });
});
