import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrpcClient } from '../api/client';
import { TrpcIngestSink } from './TrpcIngestSink';

const setup = () => {
  const mutate = vi.fn();
  const client = { aiAgent: { heteroFinish: { mutate } } } as unknown as TrpcClient;
  return { mutate, sink: new TrpcIngestSink(client, 'kimi-code', 'owned-op', 'owned-topic') };
};
afterEach(() => vi.useRealTimers());

describe('heterogeneous completion delivery', () => {
  it('retries a backend outage using the identical completion receipt', async () => {
    vi.useFakeTimers();
    const { mutate, sink } = setup();
    mutate
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ success: true });
    const completed = sink.finish({ result: 'success', sessionId: 'session' });
    const assertion = expect(completed).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await assertion;
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[0][0]).toEqual(mutate.mock.calls[1][0]);
    expect(mutate.mock.calls[1][0]).toMatchObject({
      operationId: 'owned-op',
      topicId: 'owned-topic',
      result: 'success',
    });
  });

  it('does not retry an authorization rejection', async () => {
    const { mutate, sink } = setup();
    const error = Object.assign(new Error('Denied'), { data: { code: 'UNAUTHORIZED' } });
    mutate.mockRejectedValue(error);
    await expect(sink.finish({ result: 'error' })).rejects.toBe(error);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('surfaces exhausted transport retries instead of acknowledging delivery', async () => {
    vi.useFakeTimers();
    const { mutate, sink } = setup();
    mutate.mockRejectedValue(new Error('fetch failed'));
    const assertion = expect(sink.finish({ result: 'error' })).rejects.toThrow('fetch failed');
    await vi.runAllTimersAsync();
    await assertion;
    expect(mutate).toHaveBeenCalledTimes(7);
  });
});
