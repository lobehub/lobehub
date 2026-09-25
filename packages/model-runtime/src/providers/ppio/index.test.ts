// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import models from './fixtures/models.json';
import { LobePPIOAI } from './index';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobePPIOAI({ apiKey: 'test' });

  // Use vi.spyOn to mock the chat.completions.create method
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
  vi.spyOn(instance['client'].models, 'list').mockResolvedValue({ data: [] } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PPIO', () => {
  describe('models', () => {
    it('should get models', async () => {
      // Mock the models.list method
      (instance['client'].models.list as Mock).mockResolvedValue({ data: models });

      const list = await instance.models();

      expect(list).toMatchSnapshot();
    });
  });

  describe('debug', () => {
    it('should enable request debug when DEBUG_PPIO_CHAT_COMPLETION is set to 1', async () => {
      process.env.DEBUG_PPIO_CHAT_COMPLETION = '1';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'test-model',
      });

      expect(logSpy).toHaveBeenCalledWith('[requestPayload]');

      logSpy.mockRestore();
      delete process.env.DEBUG_PPIO_CHAT_COMPLETION;
    });
  });
});
