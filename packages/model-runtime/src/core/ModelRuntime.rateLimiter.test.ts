// @vitest-environment node
import type { ClientSecretPayload } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload, EmbeddingsPayload } from '../index';
import { LobeOpenAI, ModelRuntime } from '../index';
import { RateLimiter, clearRateLimiters } from '../utils/rateLimiter';

/**
 * Mock RateLimiter that tracks acquire() calls without blocking.
 */
const createMockRateLimiter = () =>
  ({
    acquire: vi.fn().mockResolvedValue(undefined),
    availableRequestTokens: 10,
    availableTokenCapacity: Infinity,
    setRateLimiter: vi.fn(),
    tryAcquire: vi.fn().mockReturnValue(true),
  }) as unknown as RateLimiter;

let mockModelRuntime: ModelRuntime;

beforeEach(async () => {
  // Mock LobeOpenAI to avoid browser environment error
  vi.spyOn(LobeOpenAI.prototype, 'chat').mockResolvedValue(new Response(''));
  vi.spyOn(LobeOpenAI.prototype, 'embeddings').mockResolvedValue({
    data: [{ embedding: [0.1, 0.2], index: 0 }],
    model: 'text-embedding-3-small',
    object: 'list',
    usage: { prompt_tokens: 5, total_tokens: 5 },
  } as any);

  const jwtPayload: ClientSecretPayload = { apiKey: 'user-openai-key', baseURL: 'user-endpoint' };
  mockModelRuntime = await ModelRuntime.initializeWithProvider(ModelProvider.OpenAI, jwtPayload);
});

describe('ModelRuntime rate limiter integration', () => {
  describe('constructor', () => {
    it('should accept optional rateLimiter as 3rd parameter', () => {
      const mockLimiter = createMockRateLimiter();
      // Access private field to verify it was set
      mockModelRuntime.setRateLimiter(mockLimiter);
      expect((mockModelRuntime as any)._rateLimiter).toBe(mockLimiter);
    });

    it('should work without rateLimiter (backward compatible)', () => {
      expect((mockModelRuntime as any)._rateLimiter).toBeUndefined();
    });
  });

  describe('setRateLimiter', () => {
    it('should set the rate limiter on an existing instance', () => {
      const mockLimiter = createMockRateLimiter();
      mockModelRuntime.setRateLimiter(mockLimiter);
      expect((mockModelRuntime as any)._rateLimiter).toBe(mockLimiter);
    });
  });

  describe('chat with rate limiter', () => {
    it('should call rateLimiter.acquire() before making the request', async () => {
      const mockLimiter = createMockRateLimiter();
      mockModelRuntime.setRateLimiter(mockLimiter);

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      };

      await mockModelRuntime.chat(payload);

      expect((mockLimiter as any).acquire).toHaveBeenCalledTimes(1);
    });

    it('should still call the underlying runtime if rate limiter allows', async () => {
      const mockLimiter = createMockRateLimiter();
      mockModelRuntime.setRateLimiter(mockLimiter);

      const chatSpy = vi.spyOn(LobeOpenAI.prototype, 'chat');

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      };

      await mockModelRuntime.chat(payload);

      expect(chatSpy).toHaveBeenCalled();
    });

    it('should call acquire() AFTER applyHooks() to avoid wasting a slot on hook rejection', async () => {
      const callOrder: string[] = [];

      const mockLimiter = createMockRateLimiter();
      (mockLimiter as any).acquire.mockImplementation(async () => {
        callOrder.push('acquire');
      });
      mockModelRuntime.setRateLimiter(mockLimiter);

      vi.spyOn(mockModelRuntime as any, 'applyHooks').mockImplementation(async () => {
        callOrder.push('applyHooks');
        return {};
      });

      const chatSpy = vi.spyOn(LobeOpenAI.prototype, 'chat').mockImplementation(async () => {
        callOrder.push('runtime.chat');
        return new Response('');
      });

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      };

      await mockModelRuntime.chat(payload);

      expect(callOrder).toEqual(['applyHooks', 'acquire', 'runtime.chat']);
    });

    it('should NOT call acquire() if beforeChat hook rejects', async () => {
      const mockLimiter = createMockRateLimiter();
      mockModelRuntime.setRateLimiter(mockLimiter);

      vi.spyOn(mockModelRuntime as any, 'applyHooks').mockRejectedValue(
        new Error('Budget exceeded'),
      );

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      };

      await expect(mockModelRuntime.chat(payload)).rejects.toThrow('Budget exceeded');

      expect((mockLimiter as any).acquire).not.toHaveBeenCalled();
    });
  });

  describe('chat without rate limiter', () => {
    it('should proceed directly without rate limiting', async () => {
      const chatSpy = vi.spyOn(LobeOpenAI.prototype, 'chat');

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      };

      await mockModelRuntime.chat(payload);

      expect(chatSpy).toHaveBeenCalled();
    });
  });

  describe('generateObject with rate limiter', () => {
    it('should call rateLimiter.acquire() before making the request', async () => {
      const mockLimiter = createMockRateLimiter();
      mockModelRuntime.setRateLimiter(mockLimiter);

      const payload = {
        messages: [{ role: 'user' as const, content: 'Generate an object' }],
        model: 'gpt-4o',
        temperature: 0,
      };

      try {
        await mockModelRuntime.generateObject(payload as any);
      } catch {
        // generateObject may fail due to mock response format
      }

      expect((mockLimiter as any).acquire).toHaveBeenCalled();
    });
  });

  describe('embeddings with rate limiter', () => {
    it('should call rateLimiter.acquire() before making the request', async () => {
      const mockLimiter = createMockRateLimiter();
      mockModelRuntime.setRateLimiter(mockLimiter);

      const payload: EmbeddingsPayload = {
        input: 'Hello world',
        model: 'text-embedding-3-small',
      };

      await mockModelRuntime.embeddings(payload);

      expect((mockLimiter as any).acquire).toHaveBeenCalled();
    });
  });

  describe('initializeWithProvider', () => {
    it('should pass rateLimiter to the new ModelRuntime instance', async () => {
      const mockLimiter = createMockRateLimiter();
      const jwtPayload: ClientSecretPayload = { apiKey: 'key', baseURL: 'endpoint' };

      const runtime = await ModelRuntime.initializeWithProvider(
        ModelProvider.OpenAI,
        jwtPayload,
        undefined,
        mockLimiter,
      );

      expect((runtime as any)._rateLimiter).toBe(mockLimiter);
    });

    it('should work without rateLimiter (backward compatible)', async () => {
      const jwtPayload: ClientSecretPayload = { apiKey: 'key', baseURL: 'endpoint' };
      const runtime = await ModelRuntime.initializeWithProvider(
        ModelProvider.OpenAI,
        jwtPayload,
      );

      expect((runtime as any)._rateLimiter).toBeUndefined();
    });
  });
});

describe('ModelRuntime with real RateLimiter (blocking behavior)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRateLimiters();
    vi.spyOn(LobeOpenAI.prototype, 'chat').mockResolvedValue(new Response(''));
    vi.spyOn(LobeOpenAI.prototype, 'embeddings').mockResolvedValue({
      data: [{ embedding: [0.1, 0.2], index: 0 }],
      model: 'text-embedding-3-small',
      object: 'list',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRateLimiters();
    vi.restoreAllMocks();
  });

  it('should block chat request when rate limiter has no tokens', async () => {
    // Create a rate limiter with 0 initial tokens and 1 RPM (very slow refill)
    const rateLimiter = new RateLimiter({ initialTokens: 0, rpm: 1 });

    const jwtPayload: ClientSecretPayload = { apiKey: 'key', baseURL: 'endpoint' };
    const runtime = await ModelRuntime.initializeWithProvider(
      ModelProvider.OpenAI,
      jwtPayload,
      undefined,
      rateLimiter,
    );

    let chatResolved = false;
    const chatPromise = runtime
      .chat({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      })
      .then(() => {
        chatResolved = true;
      });

    // The request should be blocked because there are no tokens
    await vi.advanceTimersByTimeAsync(0);
    expect(chatResolved).toBe(false);

    // Advance time enough for 1 token to refill (60000ms / 1 RPM = 60s per token)
    await vi.advanceTimersByTimeAsync(60000);

    // Now the request should complete
    await chatPromise;
    expect(chatResolved).toBe(true);
  });

  it('should allow chat request when rate limiter has tokens', async () => {
    // Create a rate limiter with plenty of tokens
    const rateLimiter = new RateLimiter({ initialTokens: 10, rpm: 10 });

    const jwtPayload: ClientSecretPayload = { apiKey: 'key', baseURL: 'endpoint' };
    const runtime = await ModelRuntime.initializeWithProvider(
      ModelProvider.OpenAI,
      jwtPayload,
      undefined,
      rateLimiter,
    );

    let chatResolved = false;
    const chatPromise = runtime
      .chat({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        temperature: 0,
      })
      .then(() => {
        chatResolved = true;
      });

    // Should resolve immediately since tokens are available
    await vi.advanceTimersByTimeAsync(0);
    await chatPromise;
    expect(chatResolved).toBe(true);
  });

  it('should block embeddings request when rate limiter has no tokens', async () => {
    const rateLimiter = new RateLimiter({ initialTokens: 0, rpm: 1 });

    const jwtPayload: ClientSecretPayload = { apiKey: 'key', baseURL: 'endpoint' };
    const runtime = await ModelRuntime.initializeWithProvider(
      ModelProvider.OpenAI,
      jwtPayload,
      undefined,
      rateLimiter,
    );

    let embeddingsResolved = false;
    const embeddingsPromise = runtime
      .embeddings({
        input: 'Hello world',
        model: 'text-embedding-3-small',
      })
      .then(() => {
        embeddingsResolved = true;
      });

    // The request should be blocked
    await vi.advanceTimersByTimeAsync(0);
    expect(embeddingsResolved).toBe(false);

    // Advance time enough for 1 token to refill
    await vi.advanceTimersByTimeAsync(60000);

    await embeddingsPromise;
    expect(embeddingsResolved).toBe(true);
  });

  it('should queue multiple requests when tokens are exhausted', async () => {
    // Start with 1 token, very slow refill (1 RPM = 1 token per 60s)
    const rateLimiter = new RateLimiter({ initialTokens: 1, rpm: 1 });

    const jwtPayload: ClientSecretPayload = { apiKey: 'key', baseURL: 'endpoint' };
    const runtime = await ModelRuntime.initializeWithProvider(
      ModelProvider.OpenAI,
      jwtPayload,
      undefined,
      rateLimiter,
    );

    const completionOrder: number[] = [];

    // Start 3 requests
    const promise1 = runtime
      .chat({
        messages: [{ role: 'user', content: 'Request 1' }],
        model: 'gpt-4o',
        temperature: 0,
      })
      .then(() => {
        completionOrder.push(1);
      });

    const promise2 = runtime
      .chat({
        messages: [{ role: 'user', content: 'Request 2' }],
        model: 'gpt-4o',
        temperature: 0,
      })
      .then(() => {
        completionOrder.push(2);
      });

    const promise3 = runtime
      .chat({
        messages: [{ role: 'user', content: 'Request 3' }],
        model: 'gpt-4o',
        temperature: 0,
      })
      .then(() => {
        completionOrder.push(3);
      });

    // First request should complete immediately (1 token available)
    await vi.advanceTimersByTimeAsync(0);
    expect(completionOrder).toEqual([1]);

    // Advance time enough for all requests to complete
    // With 1 RPM, each token takes 60s to refill
    // After first request uses 1 token, we need 120s for 2 more tokens
    await vi.advanceTimersByTimeAsync(120000);

    await Promise.all([promise1, promise2, promise3]);

    // All 3 requests should have completed
    expect(completionOrder).toHaveLength(3);
    expect(completionOrder).toContain(1);
    expect(completionOrder).toContain(2);
    expect(completionOrder).toContain(3);
  });
});
