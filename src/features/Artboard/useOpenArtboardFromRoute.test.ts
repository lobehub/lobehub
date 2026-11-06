import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { ARTBOARD_TOOL } from './Conversation/tool';
import { useOpenArtboardFromRoute } from './useOpenArtboardFromRoute';

const openBoardPanel = vi.fn();
let resolveLoad: () => void = () => {};

vi.mock('./Conversation/openBoardPanel', () => ({
  openBoardPanel: (id: string) => openBoardPanel(id),
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
  useChatStore.setState({
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
  it('opens the board panel only after the artboard tool has registered its portal', async () => {
    renderHook(() => useOpenArtboardFromRoute(), { wrapper });

    expect(openBoardPanel).not.toHaveBeenCalled();

    await act(async () => resolveLoad());

    expect(openBoardPanel).toHaveBeenCalledWith('tool_1');
  });
});
