import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrpcClient } from '../api/client';
import { TrpcIngestSink } from './TrpcIngestSink';

const setup = () => {
  const mutate = vi.fn();
  const ingestMutate = vi.fn();
  const client = {
    aiAgent: { heteroFinish: { mutate }, heteroIngest: { mutate: ingestMutate } },
  } as unknown as TrpcClient;
  return {
    ingestMutate,
    mutate,
    sink: new TrpcIngestSink(client, 'kimi-code', 'owned-op', 'owned-topic'),
  };
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

  it('reports the server verdict on an ingest batch, defaulting to accepted', async () => {
    const { ingestMutate, sink } = setup();

    // A server that predates the verdict answers `{ ack: true }` only.
    ingestMutate.mockResolvedValueOnce({ ack: true });
    await expect(sink.ingest([])).resolves.toEqual({ accepted: true, reason: undefined });

    ingestMutate.mockResolvedValueOnce({ accepted: false, ack: true, reason: 'stale-operation' });
    await expect(sink.ingest([])).resolves.toEqual({
      accepted: false,
      reason: 'stale-operation',
    });
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

  it('drops background tasks for the rest of the run once a server refuses them', async () => {
    const { ingestMutate, sink } = setup();
    const badRequest = Object.assign(new Error('Invalid input'), { data: { code: 'BAD_REQUEST' } });
    ingestMutate.mockRejectedValueOnce(badRequest).mockResolvedValue({ accepted: true });
    const chunk = {
      data: {},
      operationId: 'owned-op',
      stepIndex: 0,
      timestamp: 1,
      type: 'stream_chunk',
    };
    const task = { ...chunk, type: 'background_task' };

    await expect(sink.ingest([chunk, task] as any)).resolves.toEqual({ accepted: true });
    await sink.ingest([task, chunk] as any);

    expect(ingestMutate.mock.calls.map(([input]) => input.events.map((e: any) => e.type))).toEqual([
      ['stream_chunk', 'background_task'],
      ['stream_chunk'],
      ['stream_chunk'],
    ]);
  });

  it('keeps other refusals as they are', async () => {
    const { ingestMutate, sink } = setup();
    const badRequest = Object.assign(new Error('Invalid input'), { data: { code: 'BAD_REQUEST' } });
    ingestMutate.mockRejectedValue(badRequest);
    const chunk = {
      data: {},
      operationId: 'owned-op',
      stepIndex: 0,
      timestamp: 1,
      type: 'stream_chunk',
    };

    await expect(sink.ingest([chunk] as any)).rejects.toBe(badRequest);
    expect(ingestMutate).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a batch of only background tasks once the server refused them', async () => {
    const { ingestMutate, sink } = setup();
    const badRequest = Object.assign(new Error('Invalid input'), { data: { code: 'BAD_REQUEST' } });
    ingestMutate.mockRejectedValueOnce(badRequest);
    const task = {
      data: {},
      operationId: 'owned-op',
      stepIndex: 0,
      timestamp: 1,
      type: 'background_task',
    };

    // The refused batch held only tasks: dropping them leaves nothing to send.
    await expect(sink.ingest([task] as any)).resolves.toEqual({ accepted: true });
    await expect(sink.ingest([task, task] as any)).resolves.toEqual({ accepted: true });

    expect(ingestMutate).toHaveBeenCalledTimes(1);
  });
});
