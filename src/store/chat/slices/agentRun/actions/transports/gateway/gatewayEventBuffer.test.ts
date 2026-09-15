import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGatewayEventBuffer } from './gatewayEventBuffer';

const makeEvent = (
  chunkType: 'reasoning' | 'text',
  value: string,
  overrides: Partial<AgentStreamEvent> = {},
) =>
  ({
    data: chunkType === 'text' ? { chunkType, content: value } : { chunkType, reasoning: value },
    operationId: 'op-1',
    stepIndex: 1,
    timestamp: 0,
    type: 'stream_chunk',
    ...overrides,
  }) as AgentStreamEvent;

const makeToolStateEvent = (toolCallId: string, snapshotSeq: number, operationId = 'op-1') =>
  ({
    data: {
      chunkType: 'tool_state',
      pluginState: { output: `snapshot-${snapshotSeq}` },
      snapshotMode: 'replace',
      snapshotSeq,
      toolCallId,
    },
    operationId,
    stepIndex: 1,
    timestamp: 0,
    type: 'stream_chunk',
  }) as AgentStreamEvent;

describe('createGatewayEventBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });

  it('delivers the first chunk immediately and coalesces a burst into one update', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);

    buffer.push(makeEvent('text', 'A'));
    buffer.push(makeEvent('text', 'B'));
    buffer.push(makeEvent('text', 'C'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].data).toMatchObject({ content: 'A' });

    vi.advanceTimersByTime(299);
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].data).toMatchObject({ content: 'BC' });
  });

  it('flushes merged deltas in order when a delayed timer is already overdue', () => {
    const listener = vi.fn();
    const unschedule = vi.fn();
    let now = 0;
    let scheduledFlush: (() => void) | undefined;
    const buffer = createGatewayEventBuffer(listener, {
      now: () => now,
      schedule: (callback) => {
        scheduledFlush = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      unschedule,
    });

    buffer.push(makeEvent('text', 'A'));
    buffer.push(makeEvent('text', 'B'));
    now = 301;
    buffer.push(makeEvent('text', 'C'));

    expect(listener.mock.calls.map(([event]) => event.data)).toEqual([
      expect.objectContaining({ content: 'A' }),
      expect.objectContaining({ content: 'BC' }),
    ]);
    expect(unschedule).toHaveBeenCalledTimes(1);

    scheduledFlush?.();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('flushes pending prose before a semantic boundary', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);
    const toolEvent = {
      data: { chunkType: 'tools_calling', toolsCalling: [{ id: 'tool-1' }] },
      operationId: 'op-1',
      stepIndex: 1,
      timestamp: 0,
      type: 'stream_chunk',
    } as AgentStreamEvent;

    buffer.push(makeEvent('text', 'A'));
    buffer.push(makeEvent('text', 'B'));
    buffer.push(toolEvent);

    expect(listener.mock.calls.map(([event]) => event.data)).toEqual([
      expect.objectContaining({ content: 'A' }),
      expect.objectContaining({ content: 'B' }),
      toolEvent.data,
    ]);
  });

  it('keeps only the latest replace snapshot inside an update window', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);
    const snapshot = (content: string, snapshotSeq: number) =>
      makeEvent('text', content, {
        data: { chunkType: 'text', content, snapshotMode: 'replace', snapshotSeq },
      });

    buffer.push(snapshot('A', 1));
    buffer.push(snapshot('ABC', 3));
    buffer.push(snapshot('AB', 2));
    vi.advanceTimersByTime(300);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].data).toMatchObject({ content: 'ABC', snapshotSeq: 3 });
  });

  it('coalesces tool-state snapshots by operation and tool call', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);

    for (let snapshotSeq = 1; snapshotSeq <= 100; snapshotSeq += 1) {
      buffer.push(makeToolStateEvent('tool-1', snapshotSeq));
    }
    buffer.push(makeToolStateEvent('tool-1', 50));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].data).toMatchObject({ snapshotSeq: 1 });

    vi.advanceTimersByTime(300);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].data).toMatchObject({ snapshotSeq: 100 });
  });

  it('buffers parallel tool calls independently', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);

    buffer.push(makeToolStateEvent('tool-1', 1));
    buffer.push(makeToolStateEvent('tool-2', 1));
    buffer.push(makeToolStateEvent('tool-1', 2));
    buffer.push(makeToolStateEvent('tool-2', 2));

    expect(listener).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(300);

    expect(listener.mock.calls.slice(2).map(([event]) => event.data)).toEqual([
      expect.objectContaining({ snapshotSeq: 2, toolCallId: 'tool-1' }),
      expect.objectContaining({ snapshotSeq: 2, toolCallId: 'tool-2' }),
    ]);
  });

  it('flushes the latest tool state before a semantic boundary', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);
    const toolEnd = {
      data: { toolCallId: 'tool-1' },
      operationId: 'op-1',
      stepIndex: 1,
      timestamp: 0,
      type: 'tool_end',
    } as AgentStreamEvent;

    buffer.push(makeToolStateEvent('tool-1', 1));
    buffer.push(makeToolStateEvent('tool-1', 2));
    buffer.push(toolEnd);

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ snapshotSeq: 1 }) }),
      expect.objectContaining({ data: expect.objectContaining({ snapshotSeq: 2 }) }),
      toolEnd,
    ]);
  });

  it('does not merge chunks across step or operation boundaries', () => {
    const listener = vi.fn();
    const buffer = createGatewayEventBuffer(listener);

    buffer.push(makeEvent('reasoning', 'step one'));
    buffer.push(makeEvent('reasoning', 'step two', { stepIndex: 2 }));
    buffer.push(makeEvent('reasoning', 'other op', { operationId: 'op-2', stepIndex: 2 }));

    expect(listener.mock.calls.map(([event]) => event.data)).toEqual([
      expect.objectContaining({ reasoning: 'step one' }),
      expect.objectContaining({ reasoning: 'step two' }),
    ]);

    buffer.flush();
    expect(listener.mock.calls[2][0].data).toMatchObject({ reasoning: 'other op' });
  });
});
