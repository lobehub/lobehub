import { describe, expect, it, vi } from 'vitest';

vi.mock('./run.service', () => ({
  toRunToolCall: (tool: any) => ({
    arguments: tool.arguments,
    id: tool.id,
    name: `${tool.identifier}____${tool.apiName}`,
  }),
}));

const { mapJournalEvent, runEventStream } = await import('./run-events');

const ev = (type: string, data: unknown, id: string, stepIndex = 0) =>
  ({ data, id, operationId: 'op-1', stepIndex, timestamp: 1, type }) as any;

const tool = { apiName: 'search', arguments: '{"q":"x"}', id: 'call-1', identifier: 'web' };

describe('mapJournalEvent', () => {
  it('maps tool lifecycle events', () => {
    expect(mapJournalEvent(ev('tool_start', tool, '1-0'), 'op-1')).toEqual([
      expect.objectContaining({
        data: { toolCall: { arguments: '{"q":"x"}', id: 'call-1', name: 'web____search' } },
        id: '1-0',
        type: 'tool_call.started',
      }),
    ]);
    // The executor wraps the call: `{ parentMessageId, toolCalling }`.
    expect(
      mapJournalEvent(
        ev(
          'tool_end',
          {
            isSuccess: true,
            payload: { parentMessageId: 'msg-1', toolCalling: tool },
            result: { content: 'found' },
          },
          '2-0',
        ),
        'op-1',
      )[0],
    ).toMatchObject({
      data: { content: 'found', isSuccess: true, toolCall: { id: 'call-1' } },
      type: 'tool_call.completed',
    });
  });

  it('maps the assistant message end with its tool calls', () => {
    expect(
      mapJournalEvent(
        ev('stream_end', { finalContent: 'hi', toolsCalling: [tool] }, '3-0'),
        'op-1',
      )[0],
    ).toMatchObject({
      data: { content: 'hi', reasoning: null, toolCalls: [{ id: 'call-1' }] },
      type: 'message.completed',
    });
  });

  it('drops internal traffic', () => {
    for (const type of ['message_patch', 'notify_update', 'llm_execute', 'stream_retry'])
      expect(mapJournalEvent(ev(type, {}, '4-0'), 'op-1')).toEqual([]);
    expect(
      mapJournalEvent(ev('stream_chunk', { chunkType: 'tools_calling' }, '4-1'), 'op-1'),
    ).toEqual([]);
  });
});

describe('runEventStream', () => {
  const collect = async (stream: AsyncGenerator<any>) => {
    const out = [];
    for await (const item of stream) out.push(item);
    return out;
  };

  it('closes a parked run with its interventions', async () => {
    const journal = {
      getStreamHistoryPage: vi.fn().mockResolvedValueOnce({
        available: true,
        events: [
          ev('agent_runtime_init', {}, '1-0'),
          ev('agent_runtime_end', { reason: 'completed' }, '2-0', 1),
        ],
        hasMore: false,
        nextCursor: '2-0',
      }),
    };
    const intervention = {
      id: 'call-1',
      tool: { apiName: 'run', arguments: '{}', identifier: 'shell' },
      type: 'approval',
    };
    const events = await collect(
      runEventStream({
        journal,
        readRun: async () => ({
          interventions: [intervention as any],
          run: { status: 'waiting_for_human' } as any,
        }),
        runId: 'op-1',
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'intervention.requested',
      'run.waiting',
    ]);
    expect(events[1].data.interventions).toEqual([intervention]);
    expect(events[2]).toMatchObject({
      data: { status: 'waiting_for_human' },
      id: '2-0',
      stepIndex: 1,
    });
  });

  it('keeps following a run whose journal has not started yet', async () => {
    const journal = {
      getStreamHistoryPage: vi
        .fn()
        .mockResolvedValueOnce({ available: false, events: [], hasMore: false, nextCursor: '0' })
        .mockResolvedValueOnce({
          available: true,
          events: [ev('agent_runtime_end', {}, '5-0')],
          hasMore: false,
          nextCursor: '5-0',
        }),
    };
    const readRun = vi
      .fn()
      .mockResolvedValueOnce({ interventions: [], run: { status: 'queued' } })
      .mockResolvedValue({ interventions: [], run: { status: 'cancelled' } });

    const events = await collect(runEventStream({ journal, pollMs: 1, readRun, runId: 'op-1' }));

    expect(events.map((event) => event.type)).toEqual(['run.cancelled']);
  });

  it('closes from the settled run when the journal has expired', async () => {
    const journal = {
      getStreamHistoryPage: vi
        .fn()
        .mockResolvedValue({ available: false, events: [], hasMore: false, nextCursor: '9-0' }),
    };
    const events = await collect(
      runEventStream({
        after: '9-0',
        journal,
        readRun: async () => ({
          interventions: [],
          run: { result: { content: 'ok', messageId: 'm' }, status: 'completed' } as any,
        }),
        runId: 'op-1',
      }),
    );

    expect(events).toEqual([
      expect.objectContaining({
        data: { result: { content: 'ok', messageId: 'm' } },
        id: null,
        type: 'run.completed',
      }),
    ]);
  });
});
