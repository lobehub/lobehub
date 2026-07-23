import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { createAgentRuntimeExecutors } from './registry';

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

const createState = (stepCount = 0) =>
  ({
    cost: {
      calculatedAt: '2026-07-16T00:00:00.000Z',
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    lastModified: '2026-07-16T00:00:00.000Z',
    messages: [],
    operationId: 'operation-1',
    status: 'running',
    stepCount,
    toolManifestMap: {},
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
  }) satisfies AgentState;

const createHost = (stepIndex: number, publishEvent = vi.fn()) =>
  ({
    operation: { operationId: 'operation-1', stepIndex },
    transports: {
      messages: {},
      operationStore: { clearRunningMark: vi.fn() },
      stream: { publishError: vi.fn(), publishEvent },
    },
  }) as unknown as AgentRuntimeHost;

describe('createAgentRuntimeExecutors', () => {
  it('registers the complete package-owned instruction matrix', () => {
    const executors = createAgentRuntimeExecutors(createHost(0));

    expect(Object.keys(executors)).toEqual(executorTypes);
  });

  it('resolves a fresh host from the current instruction and state', async () => {
    const publishEvent = vi.fn();
    const resolveHost = vi.fn((_instruction, state: AgentState) =>
      createHost(state.stepCount, publishEvent),
    );
    const executors = createAgentRuntimeExecutors(resolveHost);
    const instruction: Extract<AgentInstruction, { type: 'finish' }> = {
      reason: 'completed',
      type: 'finish',
    };
    const state = createState(7);

    await executors.finish!(instruction, state);

    expect(resolveHost).toHaveBeenCalledWith(instruction, state, undefined);
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 7 }));
  });
});
