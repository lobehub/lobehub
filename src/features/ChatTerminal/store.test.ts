import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatTerminalStore } from './store';
import { xtermManager } from './xtermManager';

const { createSession, exitListeners, navListeners } = vi.hoisted(() => ({
  createSession: vi.fn(),
  exitListeners: [] as ((sessionId: string, exitCode: number) => void)[],
  navListeners: [] as ((sessionId: string, direction: -1 | 1) => void)[],
}));

vi.mock('@/services/electron/terminal', () => ({
  electronTerminalService: { createSession },
}));

vi.mock('./xtermManager', () => ({
  xtermManager: {
    close: vi.fn(),
    ensure: vi.fn(),
    focus: vi.fn(),
    onPaneNavigate: (listener: (sessionId: string, direction: -1 | 1) => void) => {
      navListeners.push(listener);
    },
    onSessionExit: (listener: (sessionId: string, exitCode: number) => void) => {
      exitListeners.push(listener);
    },
  },
}));

const pane = (id: string, flex = 1) => ({ flex, id });

const tab = (id: string, panes: string[] = [id]) => ({
  activePaneId: panes.at(-1)!,
  id,
  panes: panes.map((paneId) => pane(paneId)),
  title: id,
});

beforeEach(() => {
  vi.clearAllMocks();
  useChatTerminalStore.setState({
    activeTabIds: { topic: 'b' },
    createErrors: {},
    creatingByTopic: {},
    tabsByTopic: {
      other: [tab('x')],
      topic: [tab('a'), tab('b'), tab('c')],
    },
  });
});

describe('closeOtherTabs', () => {
  it('keeps only the given tab, closes the others, and activates it', () => {
    useChatTerminalStore.getState().closeOtherTabs('topic', 'a');

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic.map((t) => t.id)).toEqual(['a']);
    expect(activeTabIds.topic).toBe('a');
    expect(xtermManager.close).toHaveBeenCalledTimes(2);
    expect(xtermManager.close).toHaveBeenCalledWith('b');
    expect(xtermManager.close).toHaveBeenCalledWith('c');
  });

  it('leaves other topics untouched', () => {
    useChatTerminalStore.getState().closeOtherTabs('topic', 'a');

    expect(useChatTerminalStore.getState().tabsByTopic.other.map((t) => t.id)).toEqual(['x']);
  });

  it('does nothing when the tab id is not in the topic', () => {
    useChatTerminalStore.getState().closeOtherTabs('topic', 'missing');

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic).toHaveLength(3);
    expect(activeTabIds.topic).toBe('b');
    expect(xtermManager.close).not.toHaveBeenCalled();
  });

  it('kills every pane of the tabs it closes, not just their first', () => {
    useChatTerminalStore.setState({
      tabsByTopic: { topic: [tab('a'), tab('b', ['b', 'b2', 'b3'])] },
    });

    useChatTerminalStore.getState().closeOtherTabs('topic', 'a');

    expect(xtermManager.close).toHaveBeenCalledTimes(3);
    for (const id of ['b', 'b2', 'b3']) expect(xtermManager.close).toHaveBeenCalledWith(id);
  });
});

describe('closeTab', () => {
  it('kills every pane in the tab', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });

    useChatTerminalStore.getState().closeTab('topic', 'a');

    expect(xtermManager.close).toHaveBeenCalledTimes(2);
    expect(useChatTerminalStore.getState().tabsByTopic.topic).toEqual([]);
  });
});

describe('splitPane', () => {
  it('inserts the new pane after the active one and halves its width', async () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a')] } });
    createSession.mockResolvedValue({ cwd: '/repo', id: 'a2', shell: '/bin/zsh' });

    await useChatTerminalStore.getState().splitPane('topic', 'a', '/repo');

    const [target] = useChatTerminalStore.getState().tabsByTopic.topic;
    expect(target.panes).toEqual([pane('a', 0.5), pane('a2', 0.5)]);
    expect(target.activePaneId).toBe('a2');
    expect(xtermManager.ensure).toHaveBeenCalledWith('a2');
  });

  it('leaves the other panes at the width the user dragged them to', async () => {
    useChatTerminalStore.setState({
      tabsByTopic: {
        topic: [
          { activePaneId: 'a2', id: 'a', panes: [pane('a', 0.3), pane('a2', 1.7)], title: 'a' },
        ],
      },
    });
    createSession.mockResolvedValue({ cwd: '/repo', id: 'a3', shell: '/bin/zsh' });

    await useChatTerminalStore.getState().splitPane('topic', 'a', '/repo');

    expect(useChatTerminalStore.getState().tabsByTopic.topic[0].panes).toEqual([
      pane('a', 0.3),
      pane('a2', 0.85),
      pane('a3', 0.85),
    ]);
  });

  it('does not add a pane when the session fails to start', async () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a')] } });
    createSession.mockRejectedValue(new Error('no pty'));

    await useChatTerminalStore.getState().splitPane('topic', 'a', '/repo');

    const state = useChatTerminalStore.getState();
    expect(state.tabsByTopic.topic[0].panes).toEqual([pane('a')]);
    expect(state.createErrors.topic).toBe('no pty');
  });
});

describe('closePane', () => {
  it('removes the pane and keeps the tab while other panes remain', () => {
    useChatTerminalStore.setState({
      activeTabIds: { topic: 'a' },
      tabsByTopic: { topic: [tab('a', ['a', 'a2'])] },
    });

    useChatTerminalStore.getState().closePane('topic', 'a2');

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic[0].panes).toEqual([pane('a')]);
    expect(tabsByTopic.topic[0].activePaneId).toBe('a');
    expect(activeTabIds.topic).toBe('a');
    expect(xtermManager.close).toHaveBeenCalledWith('a2');
  });

  it('drops the tab once its last pane is closed', () => {
    useChatTerminalStore.setState({
      activeTabIds: { topic: 'b' },
      tabsByTopic: { topic: [tab('a'), tab('b')] },
    });

    useChatTerminalStore.getState().closePane('topic', 'b');

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic.map((t) => t.id)).toEqual(['a']);
    expect(activeTabIds.topic).toBe('a');
  });
});

describe('setActivePane', () => {
  it('activates the clicked pane', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });

    useChatTerminalStore.getState().setActivePane('topic', 'a', 'a');

    expect(useChatTerminalStore.getState().tabsByTopic.topic[0].activePaneId).toBe('a');
  });

  it('keeps state identity when the pane is already active, so a pointerdown does not rerender', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });
    const before = useChatTerminalStore.getState().tabsByTopic;

    useChatTerminalStore.getState().setActivePane('topic', 'a', 'a2');

    expect(useChatTerminalStore.getState().tabsByTopic).toBe(before);
  });
});

describe('setPaneFlex', () => {
  it('applies the dragged widths in pane order', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });

    useChatTerminalStore.getState().setPaneFlex('topic', 'a', [0.4, 1.6]);

    expect(useChatTerminalStore.getState().tabsByTopic.topic[0].panes).toEqual([
      pane('a', 0.4),
      pane('a2', 1.6),
    ]);
  });

  it('ignores a stale width list that no longer matches the pane count', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });

    useChatTerminalStore.getState().setPaneFlex('topic', 'a', [0.4]);

    expect(useChatTerminalStore.getState().tabsByTopic.topic[0].panes).toEqual([
      pane('a'),
      pane('a2'),
    ]);
  });
});

describe('pane navigation', () => {
  const navigate = (sessionId: string, direction: -1 | 1) => {
    for (const listener of navListeners) listener(sessionId, direction);
  };

  it('moves focus to the neighbouring pane and focuses its terminal', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2', 'a3'])] } });

    navigate('a2', 1);

    expect(useChatTerminalStore.getState().tabsByTopic.topic[0].activePaneId).toBe('a3');
    expect(xtermManager.focus).toHaveBeenCalledWith('a3');
  });

  it('stops at the edge instead of wrapping, matching Ghostty goto_split', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });

    navigate('a', -1);

    expect(useChatTerminalStore.getState().tabsByTopic.topic[0].activePaneId).toBe('a2');
    expect(xtermManager.focus).not.toHaveBeenCalled();
  });

  it('ignores a session that no longer belongs to any tab', () => {
    useChatTerminalStore.setState({ tabsByTopic: { topic: [tab('a', ['a', 'a2'])] } });

    navigate('gone', 1);

    expect(xtermManager.focus).not.toHaveBeenCalled();
  });
});

describe('session exit', () => {
  it('removes only the exited pane, leaving its tab open', () => {
    useChatTerminalStore.setState({
      activeTabIds: { topic: 'a' },
      tabsByTopic: { topic: [tab('a', ['a', 'a2'])] },
    });

    for (const listener of exitListeners) listener('a2', 0);

    const { tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic[0].panes).toEqual([pane('a')]);
    expect(tabsByTopic.topic[0].activePaneId).toBe('a');
  });

  it('drops the tab when the exited pane was its last one', () => {
    useChatTerminalStore.setState({
      activeTabIds: { topic: 'b' },
      tabsByTopic: { other: [tab('x')], topic: [tab('a'), tab('b')] },
    });

    for (const listener of exitListeners) listener('b', 0);

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic.map((t) => t.id)).toEqual(['a']);
    expect(activeTabIds.topic).toBe('a');
    expect(tabsByTopic.other.map((t) => t.id)).toEqual(['x']);
  });
});
