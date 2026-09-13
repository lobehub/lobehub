import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../../context';
import { ServerCallLlmStreamSink } from '../serverCallLlmStreamSink';

const THROTTLE_INTERVAL = 300;

const toolCall = (args: string): ChatToolPayload[] =>
  [{ apiName: 'write', arguments: args, id: 'call_1', identifier: 'fs', type: 'default' }] as any;

const createSink = () => {
  const publishStreamChunk = vi.fn().mockResolvedValue('1-0');
  const ctx = {
    operationId: 'op-1',
    stepIndex: 0,
    streamManager: { publishStreamChunk },
  } as unknown as RuntimeExecutorContext;

  const sink = new ServerCallLlmStreamSink({ ctx, events: [], operationLogId: 'op-1:0' });

  return { publishStreamChunk, sink };
};

/** The payload the Nth `publishStreamChunk` call carried. */
const publishedArgs = (publishStreamChunk: ReturnType<typeof vi.fn>, index: number) =>
  publishStreamChunk.mock.calls[index][2].toolsCalling[0].arguments;

describe('ServerCallLlmStreamSink tools_calling throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The core regression: providers stream tool arguments delta by delta and each
  // callback carries the FULL accumulated call list, so publishing per delta sent
  // one Redis XADD + Gateway POST per token with an ever-growing payload.
  it('collapses a burst of snapshots into a single publish per window', async () => {
    const { publishStreamChunk, sink } = createSink();

    for (let i = 1; i <= 50; i += 1) sink.queueToolsCalling(toolCall('x'.repeat(i)));

    expect(publishStreamChunk).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(THROTTLE_INTERVAL);

    expect(publishStreamChunk).toHaveBeenCalledTimes(1);
    // Only the newest snapshot matters: `tools_calling` is a full replace on the
    // client, so the dropped intermediates are lossless.
    expect(publishedArgs(publishStreamChunk, 0)).toBe('x'.repeat(50));
  });

  it('publishes at most once per window across a long stream', async () => {
    const { publishStreamChunk, sink } = createSink();

    // 5 windows' worth of deltas, 10ms apart.
    for (let i = 1; i <= 150; i += 1) {
      sink.queueToolsCalling(toolCall('x'.repeat(i)));
      await vi.advanceTimersByTimeAsync(10);
    }

    // Unthrottled this would be 150 publishes.
    expect(publishStreamChunk.mock.calls.length).toBeLessThanOrEqual(6);
    expect(publishStreamChunk.mock.calls.length).toBeGreaterThan(0);
  });

  it('ships the final snapshot on the end-of-stream flush', async () => {
    const { publishStreamChunk, sink } = createSink();

    sink.queueToolsCalling(toolCall('partial'));
    await vi.advanceTimersByTimeAsync(THROTTLE_INTERVAL);
    sink.queueToolsCalling(toolCall('complete'));

    // Stream ends inside the window — without the explicit flush the completed
    // tool call would never reach the client.
    await sink.flushToolsCallingBuffer();

    expect(publishStreamChunk).toHaveBeenCalledTimes(2);
    expect(publishedArgs(publishStreamChunk, 1)).toBe('complete');
  });

  it('does not publish twice when the flush races the pending timer', async () => {
    const { publishStreamChunk, sink } = createSink();

    sink.queueToolsCalling(toolCall('only-once'));
    await sink.flushToolsCallingBuffer();
    await vi.advanceTimersByTimeAsync(THROTTLE_INTERVAL);

    expect(publishStreamChunk).toHaveBeenCalledTimes(1);
  });

  // `clearBuffers` runs when an attempt fails and is about to be retried; a
  // pending snapshot from the dead attempt must not surface on the next one.
  it('drops a pending snapshot when the buffers are cleared', async () => {
    const { publishStreamChunk, sink } = createSink();

    sink.queueToolsCalling(toolCall('aborted'));
    sink.clearBuffers();
    await vi.advanceTimersByTimeAsync(THROTTLE_INTERVAL * 2);

    expect(publishStreamChunk).not.toHaveBeenCalled();
  });

  it('republishes on the final flush when a throttled publish failed', async () => {
    const { publishStreamChunk, sink } = createSink();
    publishStreamChunk.mockRejectedValueOnce(new Error('redis down'));

    sink.queueToolsCalling(toolCall('complete'));
    await vi.advanceTimersByTimeAsync(THROTTLE_INTERVAL);

    // The detached timer swallowed the failure rather than orphaning a rejection.
    expect(publishStreamChunk).toHaveBeenCalledTimes(1);

    await sink.flushToolsCallingBuffer();

    expect(publishStreamChunk).toHaveBeenCalledTimes(2);
    expect(publishedArgs(publishStreamChunk, 1)).toBe('complete');
  });
});
