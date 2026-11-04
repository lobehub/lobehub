import { describe, expect, it } from 'vitest';

import type { State } from '@/features/Conversation/store/initialState';

import { mcpAppAgentIdSelector } from './viewAgent';

const groupState = (dbMessages: unknown[]) =>
  // A group conversation's context carries the supervisor
  ({ context: { agentId: 'supervisor' }, dbMessages }) as unknown as State;

describe('mcpAppAgentIdSelector', () => {
  it('acts as the member whose message carries the result, not the group supervisor', () => {
    const s = groupState([{ agentId: 'member', id: 'tool-msg', role: 'tool' }]);

    expect(mcpAppAgentIdSelector('tool-msg')(s)).toBe('member');
  });

  it('finds the member whose turn holds the result inside compressed history', () => {
    const s = groupState([
      {
        compressedMessages: [
          { id: 'state-row', role: 'tool' },
          {
            agentId: 'member',
            children: [{ id: 'block', tools: [{ id: 'call', result_msg_id: 'tool-msg' }] }],
            id: 'assistant',
            role: 'assistantGroup',
          },
        ],
        id: 'compressed',
        role: 'compressedGroup',
      },
    ]);

    expect(mcpAppAgentIdSelector('tool-msg')(s)).toBe('member');
  });

  it("falls back to the conversation's agent when the message names none", () => {
    expect(mcpAppAgentIdSelector('tool-msg')(groupState([{ id: 'tool-msg', role: 'tool' }]))).toBe(
      'supervisor',
    );
    expect(mcpAppAgentIdSelector(undefined)(groupState([]))).toBe('supervisor');
  });
});
