import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import ProviderImportController, {
  fetchProviderImportPayload,
  parseProviderImportCallback,
  ProviderImportPayloadSchema,
} from '../ProviderImportCtr';

const { mockDirectDispatcher, mockUndiciFetch } = vi.hoisted(() => ({
  mockDirectDispatcher: { close: vi.fn() },
  mockUndiciFetch: vi.fn(),
}));

vi.mock('undici', () => ({
  Agent: vi.fn(() => mockDirectDispatcher),
  fetch: mockUndiciFetch,
}));

const mockBrowserManager = {
  broadcastToWindow: vi.fn(),
};

const mockApp = {
  browserManager: mockBrowserManager,
} as unknown as App;

const callbackUrl = `http://127.0.0.1:49152/lobehub/provider-import/${'a'.repeat(32)}`;
const validPayload = {
  models: [{ contextWindowTokens: 128_000, displayName: 'Example Model', id: 'example/model' }],
  provider: {
    apiKey: 'secret-key',
    baseURL: 'https://api.example.com/v1',
    checkModel: 'example/model',
    id: 'example-provider',
    name: 'Example Provider',
  },
  version: 1,
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('ProviderImportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('global fetch must not be used'))),
    );
  });

  describe('parseProviderImportCallback', () => {
    it('accepts only tokenized literal loopback callbacks', () => {
      expect(parseProviderImportCallback(callbackUrl)?.href).toBe(callbackUrl);
      expect(
        parseProviderImportCallback(`http://[::1]:49152/lobehub/provider-import/${'b'.repeat(48)}`)
          ?.hostname,
      ).toBe('[::1]');
    });

    it.each([
      `https://127.0.0.1:49152/lobehub/provider-import/${'a'.repeat(32)}`,
      `http://localhost:49152/lobehub/provider-import/${'a'.repeat(32)}`,
      `http://127.0.0.1:49152/other/${'a'.repeat(32)}`,
      'http://127.0.0.1:49152/lobehub/provider-import/short',
      `${callbackUrl}?extra=true`,
      `${callbackUrl}#fragment`,
    ])('rejects unsafe callback %s', (callback) => {
      expect(parseProviderImportCallback(callback)).toBeUndefined();
    });
  });

  describe('ProviderImportPayloadSchema', () => {
    it('accepts a bounded OpenAI-compatible provider payload', () => {
      expect(ProviderImportPayloadSchema.parse(validPayload)).toEqual(validPayload);
    });

    it('rejects duplicate models, unknown fields, and non-loopback HTTP endpoints', () => {
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          models: [validPayload.models[0], validPayload.models[0]],
        }).success,
      ).toBe(false);
      expect(
        ProviderImportPayloadSchema.safeParse({ ...validPayload, unexpected: true }).success,
      ).toBe(false);
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          provider: { ...validPayload.provider, baseURL: 'http://api.example.com/v1' },
        }).success,
      ).toBe(false);
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          provider: { ...validPayload.provider, baseURL: 'https://user:pass@api.example.com/v1' },
        }).success,
      ).toBe(false);
    });

    it('requires checkModel to be part of the imported model list', () => {
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          provider: { ...validPayload.provider, checkModel: 'missing-model' },
        }).success,
      ).toBe(false);
    });

    it('matches the persisted model ID and display-name column limits', () => {
      const exactId = 'm'.repeat(150);
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          models: [{ displayName: 'N'.repeat(200), id: exactId }],
          provider: { ...validPayload.provider, checkModel: exactId },
        }).success,
      ).toBe(true);
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          models: [{ id: 'm'.repeat(151) }],
          provider: { ...validPayload.provider, checkModel: undefined },
        }).success,
      ).toBe(false);
      expect(
        ProviderImportPayloadSchema.safeParse({
          ...validPayload,
          models: [{ displayName: 'N'.repeat(201), id: 'model' }],
          provider: { ...validPayload.provider, checkModel: undefined },
        }).success,
      ).toBe(false);
    });
  });

  describe('fetchProviderImportPayload', () => {
    it('uses a non-redirecting bounded callback request', async () => {
      mockUndiciFetch.mockResolvedValue(jsonResponse(validPayload));

      await expect(fetchProviderImportPayload(new URL(callbackUrl))).resolves.toEqual(validPayload);
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        new URL(callbackUrl),
        expect.objectContaining({
          cache: 'no-store',
          dispatcher: mockDirectDispatcher,
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects declared and streamed bodies above the limit', async () => {
      mockUndiciFetch.mockResolvedValueOnce(
        new Response('{}', {
          headers: {
            'content-length': String(256 * 1024 + 1),
            'content-type': 'application/json',
          },
        }),
      );
      await expect(fetchProviderImportPayload(new URL(callbackUrl))).rejects.toThrow(
        'invalid_payload',
      );

      const oversizedBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(256 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      });
      mockUndiciFetch.mockResolvedValueOnce(
        new Response(oversizedBody, { headers: { 'content-type': 'application/json' } }),
      );
      await expect(fetchProviderImportPayload(new URL(callbackUrl))).rejects.toThrow(
        'invalid_payload',
      );
    });

    it('rejects redirects, non-JSON responses, and invalid schemas', async () => {
      mockUndiciFetch.mockRejectedValueOnce(new TypeError('redirect mode is set to error'));
      await expect(fetchProviderImportPayload(new URL(callbackUrl))).rejects.toThrow(
        'callback_failed',
      );

      mockUndiciFetch.mockResolvedValueOnce(
        new Response('not json', { headers: { 'content-type': 'text/plain' } }),
      );
      await expect(fetchProviderImportPayload(new URL(callbackUrl))).rejects.toThrow(
        'invalid_payload',
      );

      mockUndiciFetch.mockResolvedValueOnce(jsonResponse({ version: 1 }));
      await expect(fetchProviderImportPayload(new URL(callbackUrl))).rejects.toThrow(
        'invalid_payload',
      );
    });

    it.each([
      'Application/JSON',
      'APPLICATION/JSON; charset=utf-8',
      'Application/vnd.lobehub.provider-import+json; version=1',
    ])('accepts case-insensitive callback media type %s', async (contentType) => {
      mockUndiciFetch.mockResolvedValue(
        jsonResponse(validPayload, { headers: { 'content-type': contentType } }),
      );

      await expect(fetchProviderImportPayload(new URL(callbackUrl))).resolves.toEqual(validPayload);
    });
  });

  describe('handleImportRequest', () => {
    it('broadcasts only a redacted preview and keeps the secret pending until consent', async () => {
      mockUndiciFetch.mockResolvedValue(jsonResponse(validPayload));
      const controller = new ProviderImportController(mockApp);

      await expect(controller['handleImportRequest']({ callback: callbackUrl })).resolves.toBe(
        true,
      );
      const request = mockBrowserManager.broadcastToWindow.mock.calls[0][2];
      expect(request).toEqual({
        preview: {
          modelCount: 1,
          provider: {
            baseURL: 'https://api.example.com/v1',
            checkModel: 'example/model',
            id: 'example-provider',
            name: 'Example Provider',
          },
          requestId: expect.any(String),
        },
        status: 'ready',
      });
      expect(JSON.stringify(request)).not.toContain('secret-key');

      const requestId = request.preview.requestId;
      expect(controller.listPending()).toEqual([request]);
      expect(controller.consume(requestId)).toEqual(validPayload);
      expect(controller.consume(requestId)).toBeUndefined();
    });

    it('reports invalid callbacks without making a network request', async () => {
      const controller = new ProviderImportController(mockApp);

      await expect(
        controller['handleImportRequest']({ callback: 'https://example.com/config' }),
      ).resolves.toBe(true);
      expect(mockUndiciFetch).not.toHaveBeenCalled();
      const request = mockBrowserManager.broadcastToWindow.mock.calls[0][2];
      expect(request).toEqual({
        errorCode: 'invalid_callback',
        requestId: expect.any(String),
        status: 'error',
      });
      expect(controller.listPending()).toEqual([request]);

      controller.cancel(request.requestId);
      expect(controller.listPending()).toEqual([]);
    });

    it('retains callback failures until the renderer acknowledges them', async () => {
      mockUndiciFetch.mockRejectedValue(new Error('callback server unavailable'));
      const controller = new ProviderImportController(mockApp);

      await controller['handleImportRequest']({ callback: callbackUrl });

      const request = mockBrowserManager.broadcastToWindow.mock.calls[0][2];
      expect(request).toEqual({
        errorCode: 'callback_failed',
        requestId: expect.any(String),
        status: 'error',
      });
      expect(controller.listPending()).toEqual([request]);

      controller.cancel(request.requestId);
      expect(controller.listPending()).toEqual([]);
    });

    it('cancels a pending secret without returning it to the renderer', async () => {
      mockUndiciFetch.mockResolvedValue(jsonResponse(validPayload));
      const controller = new ProviderImportController(mockApp);
      await controller['handleImportRequest']({ callback: callbackUrl });
      const requestId = mockBrowserManager.broadcastToWindow.mock.calls[0][2].preview.requestId;

      controller.cancel(requestId);

      expect(controller.consume(requestId)).toBeUndefined();
      expect(controller.listPending()).toEqual([]);
    });
  });
});
