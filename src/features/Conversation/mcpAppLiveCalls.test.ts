import { describe, expect, it } from 'vitest';

import { getLiveMcpAppToolCalls } from './mcpAppLiveCalls';

const state = () =>
  ({
    operations: {
      active: { status: 'running', type: 'toolCalling', metadata: { tool_call_id: 'live' } },
      old: { status: 'completed', type: 'toolCalling', metadata: { tool_call_id: 'history' } },
    },
    operationsByContext: { topic: ['active', 'old'] },
    toolCallingStreamIds: {},
    dbMessagesMap: {},
  }) as any;

describe('live MCP App calls', () => {
  it('observes the actual invoking call without scanning historical tools', () => {
    const input = state();
    Object.defineProperty(input, 'dbMessagesMap', {
      get: () => {
        throw new Error('history scanned');
      },
    });
    expect(getLiveMcpAppToolCalls(input, 'topic')).toEqual(['live']);
    expect(getLiveMcpAppToolCalls(input, 'other-topic')).toEqual([]);
  });
  it('observes only active streaming tool indices in the same topic', () => {
    const input = state();
    input.toolCallingStreamIds = { message: [false, true], elsewhere: [true] };
    input.dbMessagesMap = {
      topic: [{ id: 'message', tools: [{ id: 'done' }, { id: 'streaming' }] }],
      other: [{ id: 'elsewhere', tools: [{ id: 'other-topic' }] }],
    };
    expect(getLiveMcpAppToolCalls(input, 'topic')).toEqual(['live', 'streaming']);
  });
  it('never auto-opens hydrated history without a running operation', () => {
    const input = state();
    input.operations.active.status = 'completed';
    input.toolCallingStreamIds = { stale: [true] };
    Object.defineProperty(input, 'dbMessagesMap', {
      get: () => {
        throw new Error('history scanned');
      },
    });
    expect(getLiveMcpAppToolCalls(input, 'topic')).toEqual([]);
  });
});
