import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentEvalConnectorService,
  EvalConnectorBindingError,
} from '@/server/services/agentEvalConnector';

import { createEvalConnectorHook } from './evalConnectorHook';

const deps = { db: {} as never, userId: 'user' };
const snapshots = {
  notion: {
    connectorId: 'connector-id',
    datasetId: 'dataset',
    fingerprint: 'contract',
    transport: 'mcp' as const,
  },
};
const event = () => ({
  apiName: 'search',
  args: { query: 'fixture' },
  callIndex: 1,
  identifier: 'notion',
  mock: vi.fn(),
  operationId: 'op',
  stepIndex: 1,
});
afterEach(() => vi.restoreAllMocks());

describe('evaluation connection hook', () => {
  it('executes a bound call and supplies its result instead of the ordinary tool executor', async () => {
    const execute = vi
      .spyOn(AgentEvalConnectorService.prototype, 'execute')
      .mockResolvedValue({ content: 'mock-data', success: true });
    const hook = createEvalConnectorHook(deps, snapshots, { attemptId: 'attempt', caseId: 'case' });
    const call = event();
    await hook.handler!(call as never);
    expect(call.mock).toHaveBeenCalledWith({ content: 'mock-data', success: true });
    expect(execute.mock.calls[0][2].args).toBe('{"query":"fixture"}');
  });

  it('fails closed for a persisted legacy forwarding plan', async () => {
    const execute = vi.spyOn(AgentEvalConnectorService.prototype, 'execute');
    const hook = createEvalConnectorHook(deps, {}, { legacyIdentifiers: ['notion'] });
    const call = event();
    await hook.handler!(call as never);
    expect(call.mock).toHaveBeenCalledWith({
      content: 'The tool connection is unavailable.',
      success: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('intercepts legacy snapshots without falling through to the ordinary tool executor', async () => {
    const execute = vi.spyOn(AgentEvalConnectorService.prototype, 'execute');
    const hook = createEvalConnectorHook(
      deps,
      { notion: { ...snapshots.notion, datasetId: undefined } },
      {},
    );
    const call = event();
    await hook.handler!(call as never);
    expect(call.mock).toHaveBeenCalledWith({
      content: 'The tool connection is unavailable. Please try again later.',
      success: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('leaves unrelated tools to the ordinary executor', async () => {
    const hook = createEvalConnectorHook(deps, snapshots, {});
    const call = { ...event(), identifier: 'lobe-agent' };
    await hook.handler!(call as never);
    expect(call.mock).not.toHaveBeenCalled();
  });

  it('does not expose provider credentials in errors or evaluation routing details in errors', async () => {
    const execute = vi.spyOn(AgentEvalConnectorService.prototype, 'execute');
    const hook = createEvalConnectorHook(deps, snapshots, {});
    const call = event();
    execute.mockRejectedValueOnce(new Error('secret-token in https://private.test'));
    await hook.handler!(call as never);
    expect(JSON.stringify(call.mock.mock.calls)).not.toMatch(/secret-token|private.test/);
    execute.mockRejectedValueOnce(
      new EvalConnectorBindingError('The mock connection or its tools changed.'),
    );
    await hook.handler!(call as never);
    expect(call.mock).toHaveBeenLastCalledWith({
      content: 'The tool connection is unavailable. Please try again later.',
      success: false,
    });
  });
});
