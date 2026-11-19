// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeTokenDosAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

type RouterForTest = {
  apiType: string;
  models?: string[];
  options?: { baseURL?: string };
};

const resolveRouters = (model?: string) =>
  (typeof params.routers === 'function'
    ? params.routers({ apiKey: 'test' }, { model })
    : params.routers) as RouterForTest[];

describe('LobeTokenDosAI', () => {
  let instance: InstanceType<typeof LobeTokenDosAI>;

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    instance = new LobeTokenDosAI({ apiKey: 'test_api_key' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should initialize with correct provider', () => {
      expect(instance).toBeDefined();
    });

    it('should be instance of LobeTokenDosAI', () => {
      expect(instance).toBeInstanceOf(LobeTokenDosAI);
    });
  });

  describe('routers', () => {
    it('should configure anthropic router to root endpoint', () => {
      const routers = resolveRouters();
      const anthropicRouter = routers.find((router) => router.apiType === 'anthropic');

      expect(anthropicRouter).toBeDefined();
      expect(anthropicRouter?.options?.baseURL).toBe('https://api.tokendos.com');
    });

    it('should configure openai router to /v1 endpoint', () => {
      const routers = resolveRouters();
      const openaiRouter = routers.find((router) => router.apiType === 'openai');

      expect(openaiRouter).toBeDefined();
      expect(openaiRouter?.options?.baseURL).toBe('https://api.tokendos.com/v1');
    });
  });
});
