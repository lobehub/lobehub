// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeStraicoAI } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const mockFetch = vi.fn();

describe('LobeStraicoAI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('models', () => {
    it('should throw a regular Error when the API request fails', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const instance = new LobeStraicoAI({ apiKey: 'test-api-key' });

      await expect(instance.models()).rejects.toThrow('HTTP 401');
    });
  });
});
