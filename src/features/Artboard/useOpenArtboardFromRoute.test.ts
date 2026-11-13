import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { ARTBOARD_TOOL } from './Conversation/tool';
import { useOpenArtboardFromRoute } from './useOpenArtboardFromRoute';

const openBoardPanel = vi.fn();
let resolveLoad: () => void = () => {};
const { board, feature } = vi.hoisted(() => ({
  board: { topicId: 't' },
  feature: { enabled: true, ready: true },
}));

vi.mock('./useArtboardFeature', () => ({
  useArtboardFeature: () => ({ enabled: feature.ready && feature.enabled, ready: feature.ready }),
}));

vi.mock('./data/useArtboard', () => ({ useArtboard: () => ({ data: { artboard: board } }) }));

vi.mock('./Conversation/openBoardPanel', () => ({
  openBoardPanel: (...args: unknown[]) => openBoardPanel(...args),
}));

vi.mock('./loadArtboardTool', () => ({
  loadArtboardTool: () =>
    new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ['/project/p/topic/t?artboard=art_1'] }, children);

beforeEach(() => {
  openBoardPanel.mockReset();
  Object.assign(feature, { enabled: true, ready: true });
  board.topicId = 't';
  useChatStore.setState({
    activeTopicId: 't',
    dbMessagesMap: {
      t: [
        {
          id: 'tool_1',
          plugin: { identifier: ARTBOARD_TOOL },
          pluginState: { artboardId: 'art_1' },
        },
      ],
    },
  } as never);
});

describe('useOpenArtboardFromRoute', () => {
  it('opens the board tab only after the artboard tool has loaded', async () => {
    renderHook(() => useOpenArtboardFromRoute(), { wrapper });

    expect(openBoardPanel).not.toHaveBeenCalled();

    await act(async () => resolveLoad());

    expect(openBoardPanel).toHaveBeenCalledWith('art_1');
  });

  it.each(['CLI-created board', 'creation message outside the loaded window'])(
    'opens a %s by its authorized artboard id',
    async () => {
      useChatStore.setState({ dbMessagesMap: {} });
      renderHook(() => useOpenArtboardFromRoute(), { wrapper });

      await act(async () => resolveLoad());

      expect(openBoardPanel).toHaveBeenCalledWith('art_1');
    },
  );

  it('waits for the origin conversation before opening a board without a tool message', async () => {
    useChatStore.setState({ activeTopicId: 'another-topic', dbMessagesMap: {} });
    const { rerender } = renderHook(() => useOpenArtboardFromRoute(), { wrapper });

    await act(async () => resolveLoad());
    expect(openBoardPanel).not.toHaveBeenCalled();

    act(() => useChatStore.setState({ activeTopicId: 't' }));
    rerender();
    await act(async () => resolveLoad());
    expect(openBoardPanel).toHaveBeenCalledWith('art_1');
  });

  it.each([
    { enabled: false, ready: true },
    { enabled: true, ready: false },
  ])(
    'does not open a saved historical board when flags are $enabled/$ready',
    async ({ enabled, ready }) => {
      Object.assign(feature, { enabled, ready });
      renderHook(() => useOpenArtboardFromRoute(), { wrapper });

      await act(async () => resolveLoad());

      expect(openBoardPanel).not.toHaveBeenCalled();
    },
  );

  it('cancels a pending route open when the flag becomes disabled', async () => {
    const { rerender } = renderHook(() => useOpenArtboardFromRoute(), { wrapper });
    feature.enabled = false;
    rerender();

    await act(async () => resolveLoad());

    expect(openBoardPanel).not.toHaveBeenCalled();
  });
});
