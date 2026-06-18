import { describe, expect, it, vi } from 'vitest';

import { AGENT_SIGNAL_REVIEW_TOOL_API_NAMES } from './apiNames';
import {
  type AgentSignalRuntimeService,
  AgentSignalToolExecutionRuntime,
} from './ExecutionRuntime';

describe('AgentSignalToolExecutionRuntime', () => {
  it('exposes one bound method per advertised api name', () => {
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: {},
    });

    for (const apiName of AGENT_SIGNAL_REVIEW_TOOL_API_NAMES) {
      expect(typeof runtime[apiName]).toBe('function');
    }
  });

  it('routes a mutation to its primitive and stamps a mutation kind', async () => {
    const writeMemory = vi.fn(async () => ({ memoryId: 'mem_1', summary: 'stored' }));
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: { writeMemory },
    });

    const result = await (runtime.writeMemory as any)(
      { content: 'x' },
      { agentId: 'a', userId: 'u' },
    );

    expect(writeMemory).toHaveBeenCalledWith({ content: 'x' }, { agentId: 'a', userId: 'u' });
    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      apiName: 'writeMemory',
      kind: 'mutation',
      memoryId: 'mem_1',
      summary: 'stored',
    });
    expect(JSON.parse(result.content)).toEqual(result.state);
  });

  it('stamps read / artifact kinds correctly', async () => {
    const service: AgentSignalRuntimeService = { getManagedSkill: async () => ({ items: [] }) };
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service,
    });

    const skill = await (runtime.getManagedSkill as any)({}, {});
    expect(skill.state.kind).toBe('read');

    // Artifact recorders have no primitive — the runtime echoes the input.
    const idea = await (runtime.recordSelfReviewIdea as any)({ idea: 'do x' }, {});
    expect(idea.state).toEqual({ apiName: 'recordSelfReviewIdea', idea: 'do x', kind: 'artifact' });
  });

  it('surfaces primitive errors without throwing, preserving the kind', async () => {
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: {
        writeMemory: async () => {
          throw new Error('db unavailable');
        },
      },
    });

    const result = await (runtime.writeMemory as any)({}, {});
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('db unavailable');
    expect(result.state).toEqual({ apiName: 'writeMemory', kind: 'mutation' });
  });

  it('fails a mutation whose primitive is not implemented', async () => {
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: {},
    });

    const result = await (runtime.createSelfReviewProposal as any)({}, {});
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Unsupported/);
  });
});
