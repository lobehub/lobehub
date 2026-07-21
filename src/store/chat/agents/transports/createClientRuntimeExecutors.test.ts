import { describe, expect, it } from 'vitest';

import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { ChatStore } from '@/store/chat/store';

import { createClientRuntimeExecutors } from './createClientRuntimeExecutors';

const executorTypes = [
  'call_llm',
  'call_tool',
  'call_tools_batch',
  'compress_context',
  'exec_sub_agent',
  'exec_sub_agents',
  'finish',
  'request_human_approve',
  'resolve_aborted_tools',
  'resolve_blocked_tools',
];

describe('createClientRuntimeExecutors', () => {
  it('uses the complete package registry including batch and blocked tool handling', () => {
    const executors = createClientRuntimeExecutors({
      agentConfig: {} as ResolvedAgentConfig,
      get: () => ({}) as ChatStore,
      messageKey: 'agent-1_topic-1',
      operationId: 'operation-1',
    });

    expect(Object.keys(executors)).toEqual(executorTypes);
  });
});
