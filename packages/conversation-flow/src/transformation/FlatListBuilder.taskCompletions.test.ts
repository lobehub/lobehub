import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types';

const agentCall = (id: string, description: string) => ({
  apiName: 'Agent',
  arguments: JSON.stringify({ description, prompt: 'research' }),
  id,
  identifier: 'claude-code',
  type: 'default' as const,
});

/**
 * A run that launches two background subagents, ends its turn, and is woken
 * once per finished subagent. Each wake-up hangs under the run's last tool row.
 */
const messages: Message[] = [
  { content: 'plan it', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
  {
    content: '',
    createdAt: 1,
    id: 'a1',
    parentId: 'u1',
    role: 'assistant',
    tools: [agentCall('call-srv', 'Server research'), agentCall('call-fe', 'Frontend research')],
    updatedAt: 1,
  },
  {
    content: 'launched',
    createdAt: 2,
    id: 't1',
    parentId: 'a1',
    role: 'tool',
    tool_call_id: 'call-srv',
    updatedAt: 2,
  },
  {
    content: 'launched',
    createdAt: 3,
    id: 't2',
    parentId: 'a1',
    role: 'tool',
    tool_call_id: 'call-fe',
    updatedAt: 3,
  },
  {
    content: 'Both still running.',
    createdAt: 4,
    id: 'a2',
    parentId: 'a1',
    role: 'assistant',
    updatedAt: 4,
  },
  {
    content: 'Server research is done.',
    createdAt: 5,
    id: 'w1',
    metadata: {
      signal: { sourceToolCallId: 'call-srv', sourceToolName: 'Agent', type: 'task-completion' },
    },
    parentId: 't2',
    role: 'assistant',
    updatedAt: 5,
  },
  {
    content: 'Here is the plan.',
    createdAt: 6,
    id: 'w2',
    metadata: {
      signal: { sourceToolCallId: 'call-fe', sourceToolName: 'Agent', type: 'task-completion' },
    },
    parentId: 't2',
    role: 'assistant',
    updatedAt: 6,
  },
] as Message[];

describe('FlatListBuilder — task-completion blocks', () => {
  it('carries each wake-up turn’s signal lineage on its block', () => {
    const { flatList } = parse(messages);

    expect(flatList.map((m) => m.role)).toEqual(['user', 'assistantGroup']);
    const group = flatList[1] as any;
    expect(group.taskCompletions.map((b: any) => [b.id, b.metadata?.signal])).toEqual([
      ['w1', { sourceToolCallId: 'call-srv', sourceToolName: 'Agent', type: 'task-completion' }],
      ['w2', { sourceToolCallId: 'call-fe', sourceToolName: 'Agent', type: 'task-completion' }],
    ]);
  });
});
