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
const modeOf = (id: string) => useMcpAppStore.getState().views[id]?.mode;

describe('MCP App placement', () => {
  it('places a view where its declaration says, once', () => {
    mcpAppActions.registerPanel('topic-a');
    mcpAppActions.registerView('call', view);

    mcpAppActions.place('call', 'fullscreen');
    expect(modeOf('call')).toBe('fullscreen');
    // A later decision (another host mounting) never moves a placed view
    mcpAppActions.place('call', 'inline');
    expect(modeOf('call')).toBe('fullscreen');
  });

  it('keeps a side-panel view in its message where the conversation has no panel', () => {
    mcpAppActions.registerPanel('topic-b');
    mcpAppActions.registerView('call', view);

    mcpAppActions.place('call', 'fullscreen');

    expect(modeOf('call')).toBe('inline');
  });

  it('opens the panel by itself only for a call completed in the live conversation', () => {
    mcpAppActions.registerPanel('topic-a');
    mcpAppActions.registerView('history', view);
    mcpAppActions.registerView('live', view);
    mcpAppActions.markLive('live');

    mcpAppActions.place('history', 'fullscreen');
    expect(modeOf('history')).toBe('fullscreen');
    expect(gate.open).not.toHaveBeenCalled();

    mcpAppActions.place('live', 'fullscreen');
    expect(gate.open).toHaveBeenCalledWith('mcp-app:live');
    expect(mcpAppActions.consumeLive('live')).toBe(false);
  });

  it('reveals a side-panel view without changing where it lives', () => {
    mcpAppActions.registerPanel('topic-a');
    mcpAppActions.registerView('panel', view);
    mcpAppActions.registerView('inline', view);
    mcpAppActions.place('panel', 'fullscreen');
    mcpAppActions.place('inline', 'inline');

    mcpAppActions.reveal('inline');
    expect(gate.open).not.toHaveBeenCalled();
    expect(modeOf('inline')).toBe('inline');

    mcpAppActions.reveal('panel');
    expect(gate.open).toHaveBeenCalledWith('mcp-app:panel');
    expect(modeOf('panel')).toBe('fullscreen');
  });

  it("gives way to the app's own modes on its first initialization only", () => {
    mcpAppActions.registerPanel('topic-a');
    mcpAppActions.registerView('call', view);
    mcpAppActions.place('call', 'fullscreen');

    // The app supports inline only: it moves to its message
    mcpAppActions.settle('call', ['inline'], 'inline');
    expect(modeOf('call')).toBe('inline');
    expect(gate.open).not.toHaveBeenCalled();

    // The app later asks for fullscreen; remounting must not undo that
    useMcpAppStore.setState((s) => ({
      views: { ...s.views, call: { ...s.views.call, availableModes: ['inline', 'fullscreen'] } },
    }));
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('fullscreen');
    mcpAppActions.settle('call', ['inline', 'fullscreen'], 'inline');
    expect(modeOf('call')).toBe('fullscreen');
  });

  it("moves between hosts only on the app's request, within its modes and topic", () => {
    mcpAppActions.registerView('call', view);
    mcpAppActions.place('call', 'inline');
    mcpAppActions.settle('call', ['inline', 'fullscreen'], 'inline');
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('inline');
    mcpAppActions.registerPanel('topic-b');
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('inline');
    mcpAppActions.registerPanel('topic-a');
    expect(mcpAppActions.setMode('call', 'fullscreen')).toBe('fullscreen');
    expect(Object.keys(useMcpAppStore.getState().views)).toEqual(['call']);
    expect(gate.open).toHaveBeenCalledWith('mcp-app:call');
    mcpAppActions.setMode('call', 'inline');
    expect(modeOf('call')).toBe('inline');
  });

  it('drops a dismissed view and its unsent context', () => {
    mcpAppActions.registerView('call', view);
    useMcpAppStore.setState({
      contexts: {
        call: { content: 'pending', identifier: 'fixture', scope: 'topic-a', title: 'Fixture' },
      },
    });

    mcpAppActions.dismiss('call');

    expect(useMcpAppStore.getState().views.call.dismissed).toBe(true);
    expect(useMcpAppStore.getState().contexts.call).toBeUndefined();
  });

  it('does nothing when the feature is disabled, including a stale saved view', () => {
    mcpAppActions.registerView('existing', view);
    gate.enabled = false;
    mcpAppActions.registerView('new', view);
    mcpAppActions.registerPanel('topic-a');
    mcpAppActions.markLive('new');
    mcpAppActions.place('existing', 'fullscreen');
    mcpAppActions.reveal('existing');
    mcpAppActions.setMode('existing', 'fullscreen');
    expect(Object.keys(useMcpAppStore.getState().views)).toEqual(['existing']);
    expect(useMcpAppStore.getState().views.existing.placed).toBeUndefined();
    expect(useMcpAppStore.getState().panels).toEqual({});
    expect(useMcpAppStore.getState().liveCalls).toEqual({});
    expect(gate.open).not.toHaveBeenCalled();
  });
});
