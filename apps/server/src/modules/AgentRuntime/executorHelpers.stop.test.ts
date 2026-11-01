import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from './context';
import { isOperationInterrupted } from './executorHelpers';

describe('persisted tool interruption guard', () => {
  it('honors the sentinel even when an in-flight worker overwrote the state blob', async () => {
    const loadAgentState = vi.fn().mockResolvedValue({ status: 'running' });
    const context = {
      isInterrupted: vi.fn().mockResolvedValue(true),
      loadAgentState,
      operationId: 'stopped-operation',
    } as unknown as RuntimeExecutorContext;
    await expect(isOperationInterrupted(context)).resolves.toBe(true);
    expect(loadAgentState).not.toHaveBeenCalled();
  });

  it('fails closed if the authoritative interruption store is unavailable', async () => {
    const context = {
      isInterrupted: vi.fn().mockRejectedValue(new Error('store unavailable')),
      operationId: 'operation',
    } as unknown as RuntimeExecutorContext;
    await expect(isOperationInterrupted(context)).rejects.toThrow('store unavailable');
  });
});
