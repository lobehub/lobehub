import type { ErrorResponse } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMessageError } from '../parseError';

// Mock i18next
vi.mock('i18next', () => ({
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

  it('should handle timeout error correctly', async () => {
    const mockResponse = createMockResponse(undefined, false, 504);
    const error = await getMessageError(mockResponse as any);

    expect(error).toEqual({
      message: 'translated_response.504',
      type: 504,
    });
  });
});
