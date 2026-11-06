import { beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshMcpAppDiscovery } from './discovery';
import { initialState, useMcpAppStore } from './store';

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => gate.enabled },
}));
beforeEach(() => {
  gate.enabled = true;
  useMcpAppStore.setState(initialState);
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
describe('MCP compatibility discovery queue', () => {
  it('deduplicates attempts and bounds concurrent connections', async () => {
    const releases: (() => void)[] = [];
    const run = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    refreshMcpAppDiscovery('a', run);
    refreshMcpAppDiscovery('a', run);
    refreshMcpAppDiscovery('b', run);
    refreshMcpAppDiscovery('c', run);
    expect(run).toHaveBeenCalledTimes(2);
    releases.shift()!();
    await flush();
    expect(run).toHaveBeenCalledTimes(3);
    releases.forEach((release) => release());
    await flush();
  });
  it('drops queued work from the previous user after a store reset', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    refreshMcpAppDiscovery('a', () => blocker);
    refreshMcpAppDiscovery('b', () => blocker);
    const queued = vi.fn();
    refreshMcpAppDiscovery('old-user', queued);
    useMcpAppStore.setState(initialState);
    release();
    await flush();
    expect(queued).not.toHaveBeenCalled();
    refreshMcpAppDiscovery('old-user', queued);
    await flush();
    expect(queued).toHaveBeenCalledOnce();
  });
  it('does not schedule or mark discovery while disabled', () => {
    gate.enabled = false;
    const run = vi.fn();
    refreshMcpAppDiscovery('a', run);
    expect(run).not.toHaveBeenCalled();
    expect(useMcpAppStore.getState().discoveryAttempts).toEqual({});
  });
});
