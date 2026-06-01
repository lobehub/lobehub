import { describe, expect, it, vi } from 'vitest';

import { AGENT_SIGNAL_REVIEW_TOOL_API_NAMES } from './apiNames';
import { AgentSignalToolExecutionRuntime, type AgentSignalToolService } from './ExecutionRuntime';

const makeService = (
  impl: AgentSignalToolService['invoke'] = vi.fn(async () => ({ data: { ok: true } })),
): AgentSignalToolService => ({ invoke: impl });

describe('AgentSignalToolExecutionRuntime', () => {
  it('exposes one bound method per advertised api name', () => {
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: makeService(),
    });

    for (const apiName of AGENT_SIGNAL_REVIEW_TOOL_API_NAMES) {
      expect(typeof runtime[apiName]).toBe('function');
    }
  });

  it('dispatches to the service and stamps a mutation kind onto the result', async () => {
    const invoke = vi.fn(async () => ({ data: { memoryId: 'mem_1', summary: 'stored' } }));
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: makeService(invoke),
    });

    const writeMemory = runtime.writeMemory as (i: unknown, c: unknown) => Promise<any>;
    const result = await writeMemory({ content: 'x' }, { userId: 'u', agentId: 'a' });

    expect(invoke).toHaveBeenCalledWith(
      'writeMemory',
      { content: 'x' },
      { userId: 'u', agentId: 'a' },
    );
    expect(result.success).toBe(true);
    expect(result.state).toEqual({ kind: 'mutation', memoryId: 'mem_1', summary: 'stored' });
    expect(JSON.parse(result.content)).toEqual(result.state);
  });

  it('stamps read / artifact kinds correctly', async () => {
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: makeService(async () => ({ data: { items: [] } })),
    });

    const digest = await (runtime.getEvidenceDigest as any)({}, {});
    expect(digest.state.kind).toBe('read');

    const idea = await (runtime.recordSelfReviewIdea as any)({}, {});
    expect(idea.state.kind).toBe('artifact');
  });

  it('surfaces service errors without throwing, preserving the kind', async () => {
    const runtime = new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service: makeService(async () => {
        throw new Error('db unavailable');
      }),
    });

    const result = await (runtime.writeMemory as any)({}, {});
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('db unavailable');
    expect(result.state).toEqual({ kind: 'mutation' });
  });
});
