import type { AgentState } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { prepareToolResultReview } from './toolResultReview';

const call = { apiName: 'read', identifier: 'files' };
const state = { usage: { tools: { byTool: [{ name: 'files/read', calls: 1 }] } } } as AgentState;

describe('pending result review metadata', () => {
  it('captures the original call/step indices and never stores hook configuration in a message', () => {
    const hasAfterToolCallControl = vi.fn().mockReturnValue(true);
    const ctx = {
      operationId: 'op',
      stepIndex: 7,
      hookDispatcher: { hasAfterToolCallControl },
    } as unknown as RuntimeExecutorContext;
    expect(prepareToolResultReview(ctx, state, call)).toEqual({
      operationId: 'op',
      callIndex: 2,
      stepIndex: 7,
      status: 'pending',
    });
    expect(hasAfterToolCallControl).toHaveBeenCalledWith('op', undefined, call);
  });
  it('does not quarantine calls without matching controls', () => {
    const ctx = {
      operationId: 'op',
      stepIndex: 7,
      hookDispatcher: { hasAfterToolCallControl: () => false },
    } as unknown as RuntimeExecutorContext;
    expect(prepareToolResultReview(ctx, state, call)).toBeUndefined();
  });
});
