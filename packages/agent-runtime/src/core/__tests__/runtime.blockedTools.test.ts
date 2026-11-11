import { describe, expect, it } from 'vitest';

import type { Agent, AgentRuntimeContext, AgentState } from '../../types';
import { AgentRuntime } from '../runtime';

const blockedCall = (id: string) => ({
  apiName: 'readFile',
  arguments: '',
  id,
  identifier: 'lobe-local-system',
  type: 'builtin' as const,
});

describe('AgentRuntime resolve_blocked_tools per-call content', () => {
  it('writes the per-call content for calls that have one and the shared content otherwise', async () => {
    class BlockedToolAgent implements Agent {
      async runner(context: AgentRuntimeContext, _state: AgentState) {
        if (context.phase === 'user_input') {
          return {
            payload: {
              blockedContent: 'shared rejection',
              blockedContentByCallId: { call_a: 'rejection naming call_a' },
              blockedReason: 'tool_arguments_empty',
              parentMessageId: 'assistant-1',
              toolsCalling: [blockedCall('call_a'), blockedCall('call_b')],
            },
            type: 'resolve_blocked_tools' as const,
          };
        }

        return { reason: 'completed' as const, type: 'finish' as const };
      }
    }

    const runtime = new AgentRuntime(new BlockedToolAgent());
    const state = AgentRuntime.createInitialState({
      messages: [{ content: 'Read two files', role: 'user' }],
      operationId: 'blocked-per-call-test',
    });

    const result = await runtime.step(state);

    const contentById = Object.fromEntries(
      result.events.map((event: any) => [event.id, event.result.content]),
    );
    expect(contentById).toEqual({
      call_a: 'rejection naming call_a',
      call_b: 'shared rejection',
    });
    expect(result.newState.messages.filter((m) => m.role === 'tool')).toEqual([
      { content: 'rejection naming call_a', role: 'tool', tool_call_id: 'call_a' },
      { content: 'shared rejection', role: 'tool', tool_call_id: 'call_b' },
    ]);
  });
});
