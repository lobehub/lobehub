import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpAppActions } from './action';
import { useMcpAppStore } from './store';

const gate = vi.hoisted(() => ({ enabled: true, open: vi.fn() }));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableMcpApps: () => gate.enabled },
  getServerConfigStoreState: () => ({}),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => ({ openWorkingSidebar: gate.open }) },
}));

beforeEach(() => {
  mcpAppActions.reset();
  gate.enabled = true;
  gate.open.mockReset();
});
const view = { identifier: 'fixture', messageId: 'message', scope: 'topic-a', title: 'Fixture' };
describe('MCP App ownership', () => {
  it('moves one view between hosts and respects available modes and topic scope', () => {
    mcpAppActions.registerView('call', view);
    mcpAppActions.setAvailableModes('call', ['inline', 'fullscreen']);
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('inline');
    mcpAppActions.registerPanel('topic-b');
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('inline');
    mcpAppActions.registerPanel('topic-a');
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('fullscreen');
    expect(Object.keys(useMcpAppStore.getState().views)).toEqual(['call']);
    expect(gate.open).toHaveBeenCalledWith('mcp-app:call');
    mcpAppActions.setMode('call', 'inline');
    expect(useMcpAppStore.getState().views.call.mode).toBe('inline');
  });
  it('only grants automatic opening to observed live calls, once', () => {
    expect(mcpAppActions.consumeLive('history')).toBe(false);
    mcpAppActions.markLive('live');
    expect(mcpAppActions.consumeLive('live')).toBe(true);
    expect(mcpAppActions.consumeLive('live')).toBe(false);
  });
  it('does nothing when the feature is disabled, including a stale saved view', () => {
    mcpAppActions.registerView('existing', view);
    gate.enabled = false;
    mcpAppActions.registerView('new', view);
    mcpAppActions.registerPanel('topic-a');
    mcpAppActions.markLive('new');
    mcpAppActions.setMode('existing', 'fullscreen');
    expect(Object.keys(useMcpAppStore.getState().views)).toEqual(['existing']);
    expect(useMcpAppStore.getState().panels).toEqual({});
    expect(useMcpAppStore.getState().liveCalls).toEqual({});
    expect(gate.open).not.toHaveBeenCalled();
  });
});
