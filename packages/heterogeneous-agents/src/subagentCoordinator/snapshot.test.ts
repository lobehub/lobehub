import { describe, expect, it } from 'vitest';

import type { SubagentThreadMessage } from './snapshot';
import { buildFinalizedSubagentRunSnapshot, buildSubagentRunSnapshot } from './snapshot';

const tool = (id: string) => ({
  apiName: 'Bash',
  arguments: '{}',
  id,
  identifier: 'bash',
  type: 'default',
});

const messages: SubagentThreadMessage[] = [
  // Parent rows a thread query returns alongside the thread's own rows.
  { id: 'main-asst', role: 'assistant', threadId: null },
  { content: 'go', id: 'seed', role: 'user', threadId: 'thd-1' },
  {
    content: 'looking',
    id: 'asst-1',
    metadata: { subagentMessageId: 'm1' },
    role: 'assistant',
    threadId: 'thd-1',
    tools: [{ ...tool('t1'), result_msg_id: 'tool-1' }],
  },
  { id: 'tool-1', role: 'tool', threadId: 'thd-1', tool_call_id: 't1' },
  {
    content: 'half a sentence',
    id: 'asst-2',
    // A usage write re-stamps the turn id as `heteroMessageId`.
    metadata: { heteroMessageId: 'm2' },
    reasoning: { content: 'thinking' },
    role: 'assistant',
    threadId: 'thd-1',
    tools: [tool('t2')],
  },
  { id: 'tool-2', role: 'tool', threadId: 'thd-1', tool_call_id: 't2' },
];

describe('buildSubagentRunSnapshot', () => {
  it('restores the in-flight turn from the thread tail', () => {
    expect(buildSubagentRunSnapshot('task-1', 'thd-1', messages)).toEqual({
      accContent: 'half a sentence',
      accReasoning: 'thinking',
      currentAssistantId: 'asst-2',
      currentSubagentMessageId: 'm2',
      lastChainParentId: 'asst-2',
      lifetimeToolCallIds: ['t1', 't2'],
      parentToolCallId: 'task-1',
      threadId: 'thd-1',
      turnIds: ['m1', 'm2'],
      // No result_msg_id yet: the tool row id comes from the row itself.
      turnTools: [{ payload: tool('t2'), toolMessageId: 'tool-2' }],
    });
  });

  it('returns undefined when the thread has no assistant yet', () => {
    expect(buildSubagentRunSnapshot('task-1', 'thd-1', messages.slice(0, 2))).toBeUndefined();
  });
});

describe('buildFinalizedSubagentRunSnapshot', () => {
  it('anchors on the newest non-tool row and keeps the known turns', () => {
    const finalized = [
      ...messages,
      { content: 'final report', id: 'hand-back', role: 'assistant', threadId: 'thd-1' },
    ];

    expect(buildFinalizedSubagentRunSnapshot('task-1', 'thd-1', finalized)).toEqual({
      lastChainParentId: 'hand-back',
      lifetimeToolCallIds: ['t1', 't2'],
      parentToolCallId: 'task-1',
      threadId: 'thd-1',
      turnIds: ['m1', 'm2'],
    });
  });

  it('returns undefined for a thread without rows', () => {
    expect(buildFinalizedSubagentRunSnapshot('task-1', 'thd-1', messages.slice(0, 1))).toBe(
      undefined,
    );
  });
});
