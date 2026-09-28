import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { InspectError, inspectSnapshot } from './inspectSnapshot';

const snapshot = (steps: Partial<ExecutionSnapshot['steps'][number]>[]): ExecutionSnapshot =>
  ({
    completedAt: 2,
    model: 'deepseek-v4-flash',
    operationId: 'op_1_agt_a_tpc_b_c',
    provider: 'lobehub',
    startedAt: 1,
    steps: steps.map((step, index) => ({
      completedAt: 2,
      executionTimeMs: 1,
      startedAt: 1,
      stepIndex: index,
      stepType: 'call_llm',
      totalCost: 0,
      totalTokens: 0,
      ...step,
    })),
    totalCost: 0,
    totalSteps: steps.length,
    totalTokens: 0,
    traceId: 'trace-1',
  }) as ExecutionSnapshot;

const withSystemRole = (role: string) => ({
  contextEngine: {
    output: [
      { content: role, role: 'system' },
      { content: 'env block', role: 'user' },
    ],
  },
});

describe('inspectSnapshot', () => {
  it('renders the whole snapshot as JSON when no step is targeted', () => {
    const snap = snapshot([{}]);
    expect(JSON.parse(inspectSnapshot(snap, { json: true })).operationId).toBe(snap.operationId);
  });

  it('renders a single step as JSON when a step is targeted', () => {
    const snap = snapshot([{}, {}]);
    expect(JSON.parse(inspectSnapshot(snap, { json: true, step: '1' })).stepIndex).toBe(1);
  });

  it('defaults the step-scoped views to step 0', () => {
    const snap = snapshot([withSystemRole('first'), withSystemRole('second')]);
    expect(JSON.parse(inspectSnapshot(snap, { json: true, systemRole: true }))).toBe('first');
  });

  it('honours an explicit step for the step-scoped views', () => {
    const snap = snapshot([withSystemRole('first'), withSystemRole('second')]);
    expect(JSON.parse(inspectSnapshot(snap, { json: true, step: '1', systemRole: true }))).toBe(
      'second',
    );
  });

  it('reads the env view off the first user message', () => {
    const snap = snapshot([withSystemRole('role')]);
    expect(JSON.parse(inspectSnapshot(snap, { env: true, json: true }))).toEqual({
      content: 'env block',
      role: 'user',
    });
  });

  it('surfaces the payload tools recorded on the step', () => {
    const tools = [{ function: { name: 'search' }, type: 'function' }];
    const snap = snapshot([{ context: { payload: { tools }, phase: 'x' } }]);

    // `toolsConfig` is absent rather than null: an undefined value is dropped by
    // JSON.stringify, which is what the original inspect command emitted too.
    expect(JSON.parse(inspectSnapshot(snap, { json: true, payloadTools: true }))).toEqual({
      payloadTools: tools,
    });
  });

  it('rejects --diff without a content view to diff', () => {
    expect(() => inspectSnapshot(snapshot([{}]), { diff: '1' })).toThrow(InspectError);
  });

  it('reports which steps exist when the requested one does not', () => {
    expect(() => inspectSnapshot(snapshot([{}, {}]), { json: true, step: '7' })).toThrow(
      /Step 7 not found. Available: 0, 1/,
    );
  });

  it('lets --agent-signal win over the step views', () => {
    const snap = snapshot([withSystemRole('role')]);
    const result = inspectSnapshot(snap, { agentSignal: true, json: true, systemRole: true });
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
