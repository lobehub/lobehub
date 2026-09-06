import type { ErrorResponse } from '@lobechat/types';
import { t } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessageError } from '../parseError';

// Mock i18next
const loadNamespaces = vi.fn(async () => {});
vi.mock('i18next', () => ({
  default: { loadNamespaces: (...args: unknown[]) => loadNamespaces(...(args as [])) },
  t: vi.fn((key) => `translated_${key}`),
}));

// Mock Response
const createMockResponse = (body: any, ok: boolean, status: number = 200) => ({
  ok,
  status,
  json: vi.fn(async () => body),
  clone: vi.fn(function () {
    // @ts-ignore
    return this;
  }),
  text: vi.fn(async () => JSON.stringify(body)),
  body: {
    getReader: () => {
      let done = false;
      return {
        read: () => {
          if (!done) {
            done = true;
            return Promise.resolve({
              value: new TextEncoder().encode(JSON.stringify(body)),
              done: false,
            });
          } else {
            return Promise.resolve({ done: true });
          }
        },
      };
    },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMessageError', () => {
  it('should handle business error correctly', async () => {
    const mockErrorResponse: ErrorResponse = {
      body: 'Error occurred',
      errorType: 'InvalidAccessCode',
    };
    const mockResponse = createMockResponse(mockErrorResponse, false, 400);

    const error = await getMessageError(mockResponse as any);

    expect(error).toEqual({
      body: mockErrorResponse.body,
      message: 'translated_response.InvalidAccessCode',
      type: mockErrorResponse.errorType,
    });
    expect(mockResponse.json).toHaveBeenCalled();
  });

  it('should handle regular error correctly', async () => {
    const mockResponse = createMockResponse({}, false, 500);
    mockResponse.json.mockImplementationOnce(() => {
      throw new Error('Failed to parse');
    });

    const error = await getMessageError(mockResponse as any);

    expect(error).toEqual({
      message: 'translated_response.500',
      type: 500,
    });
    expect(mockResponse.json).toHaveBeenCalled();
  });

  it('should surface the desktop proxy network errorType instead of a generic 502', async () => {
    const mockErrorResponse: ErrorResponse = {
      body: { detail: 'net::ERR_TIMED_OUT', url: 'https://remote.example.com/trpc/hello' },
      errorType: 'RemoteServerTimeout',
    };
    const mockResponse = createMockResponse(mockErrorResponse, false, 502);

    const error = await getMessageError(mockResponse as any);

    expect(error).toEqual({
      body: mockErrorResponse.body,
      message: 'translated_response.RemoteServerTimeout',
      type: 'RemoteServerTimeout',
    });
  });

  it('should look runtime error codes up in the modelRuntime namespace', async () => {
    // Regression: these keys live under `modelRuntime:<code>`, not the legacy
    // `error:response.<code>` map, so the old lookup echoed the raw key back and
    // users saw literal `response.InvalidProviderAPIKey` in the failure toast.
    const mockErrorResponse: ErrorResponse = {
      body: { provider: 'meta' },
      errorType: 'InvalidProviderAPIKey',
    };
    const mockResponse = createMockResponse(mockErrorResponse, false, 401);

    const error = await getMessageError(mockResponse as any);

    // `provider` is resolved from the id on the body to the provider's display name.
    expect(t).toHaveBeenCalledWith('InvalidProviderAPIKey', {
      defaultValue: 'translated_response.UnknownChatFetchError',
      ns: 'modelRuntime',
      provider: 'Meta',
    });
    expect(error.message).toBe('translated_InvalidProviderAPIKey');
  });

  it('should fall back to the raw provider id when it is not a known provider', async () => {
    const mockResponse = createMockResponse(
      { body: { provider: 'not-a-provider' }, errorType: 'InvalidProviderAPIKey' },
      false,
      401,
    );

    await getMessageError(mockResponse as any);

    expect(t).toHaveBeenCalledWith(
      'InvalidProviderAPIKey',
      expect.objectContaining({ ns: 'modelRuntime', provider: 'not-a-provider' }),
    );
  });

  it('should translate deprecated alias codes under their canonical key', async () => {
    /** Legacy server payloads may contain aliases excluded from the current ErrorResponse type. */
    const response = Response.json({ body: {}, errorType: 'PipelineError' }, { status: 500 });

    await getMessageError(response);

    expect(t).toHaveBeenCalledWith(
      'ContextEnginePipelineError',
      expect.objectContaining({ ns: 'modelRuntime' }),
    );
  });

  it('should prefer the backend message as the fallback for codes without a locale entry', async () => {
    // `NoAvailableProvider` is a registered runtime code with no `modelRuntime`
    // key yet; without a defaultValue the toast would show the bare code.
    const mockResponse = createMockResponse(
      { body: { message: 'empty providers', provider: 'meta' }, errorType: 'NoAvailableProvider' },
      false,
      500,
    );

    await getMessageError(mockResponse as any);

    expect(t).toHaveBeenCalledWith('NoAvailableProvider', {
      defaultValue: 'empty providers',
      ns: 'modelRuntime',
      provider: 'Meta',
    });
  });

  it('should load both namespaces before translating', async () => {
    // Namespaces are route-lazy and this path runs outside React, so without an
    // explicit load i18next echoes the key back instead of the message.
    const mockResponse = createMockResponse(
      { body: {}, errorType: 'InvalidProviderAPIKey' } satisfies ErrorResponse,
      false,
      401,
    );

    await getMessageError(mockResponse as any);

    expect(loadNamespaces).toHaveBeenCalledWith(['error', 'modelRuntime']);
  });

  it('should keep app-only error types on the legacy error namespace', async () => {
    const mockErrorResponse: ErrorResponse = {
      body: 'Error occurred',
      errorType: 'InvalidAccessCode',
    };
    const mockResponse = createMockResponse(mockErrorResponse, false, 401);

    await getMessageError(mockResponse as any);

    expect(t).toHaveBeenCalledWith(
      'response.InvalidAccessCode',
      expect.objectContaining({ ns: 'error', provider: '' }),
    );
  });

  it('should handle timeout error correctly', async () => {
    const mockResponse = createMockResponse(undefined, false, 504);
    const error = await getMessageError(mockResponse as any);

    expect(error).toEqual({
      message: 'translated_response.504',
      type: 504,
    });
  });
});
