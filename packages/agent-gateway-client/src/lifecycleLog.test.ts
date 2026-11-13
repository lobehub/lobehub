import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logGatewayLifecycle } from './lifecycleLog';

let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const event = (type: string, data?: unknown, operationId?: string) => ({
  data,
  operationId,
  stepIndex: 0,
  timestamp: 0,
  type,
});

describe('logGatewayLifecycle', () => {
  it('logs connection edges with the operation id', () => {
    logGatewayLifecycle('AgentStreamClient', 'op_1', 'status_changed', ['connected']);
    logGatewayLifecycle('AgentStreamClient', 'op_1', 'session_complete', [
      { source: 'raw_session_complete' },
    ]);
    logGatewayLifecycle('AgentStreamClient', 'op_1', 'auth_failed', ['expired']);

    expect(info.mock.calls.map(([line]) => line)).toEqual([
      '[AgentStreamClient] op_1 status_changed connected',
      '[AgentStreamClient] op_1 session_complete source=raw_session_complete',
      '[AgentStreamClient] op_1 auth_failed expired',
    ]);
  });

  it('logs only this operation’s terminal agent events', () => {
    logGatewayLifecycle('OperationClient', 'op_1', 'agent_event', [event('stream_chunk')]);
    logGatewayLifecycle('OperationClient', 'op_1', 'agent_event', [
      event('agent_runtime_end', { reason: 'done' }, 'op_member'),
    ]);
    logGatewayLifecycle('OperationClient', 'op_1', 'agent_event', [
      event('agent_runtime_end', { reason: 'done' }),
    ]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      '[OperationClient] op_1 terminal agent_runtime_end reason=done',
    );
  });
});
