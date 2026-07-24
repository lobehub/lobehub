import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatTerminalStore } from './store';
import { xtermManager } from './xtermManager';

vi.mock('@/services/electron/terminal', () => ({
  electronTerminalService: { createSession: vi.fn() },
}));

vi.mock('./xtermManager', () => ({
  xtermManager: { close: vi.fn(), ensure: vi.fn(), onSessionExit: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useChatTerminalStore.setState({
    activeTabIds: { topic: 'b' },
    tabsByTopic: {
      other: [{ id: 'x', title: 'x' }],
      topic: [
        { id: 'a', title: 'a' },
        { id: 'b', title: 'b' },
        { id: 'c', title: 'c' },
      ],
    },
  });
});

describe('closeOtherTabs', () => {
  it('keeps only the given tab, closes the others, and activates it', () => {
    useChatTerminalStore.getState().closeOtherTabs('topic', 'a');

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic).toEqual([{ id: 'a', title: 'a' }]);
    expect(activeTabIds.topic).toBe('a');
    expect(xtermManager.close).toHaveBeenCalledTimes(2);
    expect(xtermManager.close).toHaveBeenCalledWith('b');
    expect(xtermManager.close).toHaveBeenCalledWith('c');
  });

  it('leaves other topics untouched', () => {
    useChatTerminalStore.getState().closeOtherTabs('topic', 'a');

    expect(useChatTerminalStore.getState().tabsByTopic.other).toEqual([{ id: 'x', title: 'x' }]);
  });

  it('does nothing when the tab id is not in the topic', () => {
    useChatTerminalStore.getState().closeOtherTabs('topic', 'missing');

    const { activeTabIds, tabsByTopic } = useChatTerminalStore.getState();
    expect(tabsByTopic.topic).toHaveLength(3);
    expect(activeTabIds.topic).toBe('b');
    expect(xtermManager.close).not.toHaveBeenCalled();
  });
});
