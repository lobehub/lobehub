// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import models from './fixtures/models.json';
import { LobeNovitaAI } from './index';

const provider = ModelProvider.Novita;
const defaultBaseURL = 'https://api.novita.ai/v3/openai';

testProvider({
  Runtime: LobeNovitaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_NOVITA_CHAT_COMPLETION',
  chatModel: 'gpt-3.5-turbo',
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeNovitaAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
  vi.spyOn(instance['client'].models, 'list').mockResolvedValue({ data: [] } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NovitaAI', () => {
  describe('models', () => {
    it('should get models', async () => {
      // mock the models.list method
      (instance['client'].models.list as Mock).mockResolvedValue({ data: models });

      const list = await instance.models();

      expect(list).toMatchSnapshot();
    });
  });
});
