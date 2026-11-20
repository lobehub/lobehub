import type { ExecAgentResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { toClientExecAgentResult } from './groupMemberContinuationResult';

const base = {
  agentId: 'agt_carol',
  assistantMessageId: 'msg-1',
  autoStarted: true,
  createdAt: '2026-09-28T00:00:00.000Z',
  message: 'ok',
  operationId: 'op-member-continuation',
  status: 'created',
  success: true,
  timestamp: '2026-09-28T00:00:00.000Z',
  topicId: 'tpc-1',
  userMessageId: 'msg-user-1',
} satisfies ExecAgentResult;

// Codex P1 on #20093: a client released before member continuations took the
// returned operationId as the topic's new run, dropping the supervisor's stream.
describe('toClientExecAgentResult', () => {
  it("names the supervisor's run for a member continuation and keeps the member op aside", () => {
    expect(
      toClientExecAgentResult({
        ...base,
        groupMemberContinuation: true,
        supervisorOperationId: 'op-supervisor',
      }),
    ).toEqual({
      ...base,
      groupMemberContinuation: true,
      memberOperationId: 'op-member-continuation',
      operationId: 'op-supervisor',
    });
  });

  it('passes every other result through unchanged', () => {
    expect(toClientExecAgentResult(base)).toEqual(base);
  });
});
