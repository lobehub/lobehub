// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHeaders, queryTask, submitTask } from './api';

global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

const options = { apiKey: 'test-api-key', provider: 'wavespeed' };

const jsonResponse = (body: unknown, init?: { ok?: boolean; status?: number }) =>
  ({
    json: async () => body,
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'Error',
  }) as Response;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe('buildHeaders', () => {
  it('should send bearer auth and the LobeHub channel attribution header', () => {
    expect(buildHeaders('sk-test')).toEqual({
      'Authorization': 'Bearer sk-test',
      'Content-Type': 'application/json',
      'X-Client-Name': 'lobehub',
    });
  });
});

describe('submitTask', () => {
  it('should POST to /api/v3/{model} and return the prediction id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 200, data: { id: 'pred-1' } }));

    const id = await submitTask('bytedance/seedream-v5.0-pro', { prompt: 'a cat' }, options);

    expect(id).toBe('pred-1');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.0-pro',
      expect.objectContaining({
        body: JSON.stringify({ prompt: 'a cat' }),
        headers: expect.objectContaining({ 'X-Client-Name': 'lobehub' }),
        method: 'POST',
      }),
    );
  });

  it('should honour a custom baseURL and strip trailing slashes', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 200, data: { id: 'pred-1' } }));

    await submitTask('some/model', {}, { ...options, baseURL: 'https://proxy.example.com/' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://proxy.example.com/api/v3/some/model',
      expect.anything(),
    );
  });

  /**
   * WaveSpeed bills per accepted prediction, so a retried submit would create
   * and charge for a duplicate task.
   */
  it('should never retry the submit request', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'boom' }, { ok: false, status: 500 }));

    await expect(submitTask('some/model', {}, options)).rejects.toThrow('boom');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should attach the HTTP status so auth failures can be identified', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: 'unauthorized' }, { ok: false, status: 401 }),
    );

    await expect(submitTask('some/model', {}, options)).rejects.toMatchObject({ status: 401 });
  });

  it('should throw when no prediction id comes back', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 200, data: {} }));

    await expect(submitTask('some/model', {}, options)).rejects.toThrow(
      'did not return a prediction id',
    );
  });
});

describe('queryTask', () => {
  it('should GET the prediction result endpoint', async () => {
    const payload = { code: 200, data: { id: 'pred-1', status: 'completed', outputs: ['u'] } };
    mockFetch.mockResolvedValueOnce(jsonResponse(payload));

    await expect(queryTask('pred-1', options)).resolves.toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wavespeed.ai/api/v3/predictions/pred-1/result',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should throw a descriptive error on a failed poll', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, { ok: false, status: 404 }));

    await expect(queryTask('pred-1', options)).rejects.toThrow('pred-1');
  });
});
