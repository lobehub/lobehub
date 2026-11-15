import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreConnector } from '@/store/tool/slices/connector/replaceConnector';

import { saveConnectorEdit } from './connectorEdit';

vi.mock('@/store/tool/slices/connector/replaceConnector', () => ({
  restoreConnector: vi.fn().mockResolvedValue(undefined),
}));

const previous = {
  id: 'c1',
  mcpConnectionType: 'stdio',
  mcpStdioConfig: { args: ['-y', 'old-mcp'], command: 'npx' },
  sourceType: 'marketplace',
  status: 'connected',
};
const patch = {
  mcpConnectionType: 'stdio' as const,
  mcpStdioConfig: { args: [], command: 'not-a-command' },
};

const makeStore = () => {
  const state = {
    getConnectorForEdit: vi.fn().mockResolvedValue(previous),
    syncConnectorTools: vi.fn().mockResolvedValue(undefined),
    updateConnector: vi.fn().mockResolvedValue(undefined),
  };
  return { get: () => state as never, state };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveConnectorEdit', () => {
  it('stores the edit, then lists its tools again, dropping the ones it no longer has', async () => {
    const { get, state } = makeStore();

    await saveConnectorEdit('c1', patch, get);

    expect(state.updateConnector).toHaveBeenCalledWith('c1', patch);
    expect(state.syncConnectorTools).toHaveBeenCalledWith('c1', { pruneMissingAutoTools: true });
    expect(state.syncConnectorTools.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.updateConnector.mock.invocationCallOrder[0],
    );
    expect(restoreConnector).not.toHaveBeenCalled();
  });

  // The old tools would otherwise stay callable against the endpoint the edit stored
  it('puts the connector back when the edited endpoint lists no tools', async () => {
    const { get, state } = makeStore();
    const failure = new Error('spawn not-a-command ENOENT');
    state.syncConnectorTools.mockRejectedValueOnce(failure);

    await expect(saveConnectorEdit('c1', patch, get)).rejects.toBe(failure);

    // Read before the edit overwrote it
    expect(state.getConnectorForEdit.mock.invocationCallOrder[0]).toBeLessThan(
      state.updateConnector.mock.invocationCallOrder[0],
    );
    expect(restoreConnector).toHaveBeenCalledWith(previous, get);
  });

  it('still reports the failed save when the restore fails too', async () => {
    const { get, state } = makeStore();
    const failure = new Error('unreachable');
    state.syncConnectorTools.mockRejectedValueOnce(failure);
    vi.mocked(restoreConnector).mockRejectedValueOnce(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(saveConnectorEdit('c1', patch, get)).rejects.toBe(failure);
    expect(consoleError).toHaveBeenCalled();
  });
});
