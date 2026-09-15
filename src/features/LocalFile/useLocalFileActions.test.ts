/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { createLocalFileTabId } from '@/store/chat/slices/portal/helpers';

import { useLocalFileActions } from './useLocalFileActions';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

const openLocalFileOrFolder = vi.hoisted(() => vi.fn());

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    openFileFolder: vi.fn(),
    openLocalFileOrFolder,
  },
}));

const setWorkingDirectory = (workingDirectory: string) => {
  useChatStore.setState({
    activeAgentId: 'agent-1',
    activeTopicId: 'topic-1',
    topicDataMap: {
      'agent_agent-1': {
        items: [{ id: 'topic-1', metadata: { workingDirectory } }],
        total: 1,
      },
    } as any,
  });
};

describe('useLocalFileActions', () => {
  afterEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
    vi.clearAllMocks();
  });

  it('opens the right-side portal preview when clicking a file chip', () => {
    setWorkingDirectory('/Users/me/project');

    const { result } = renderHook(() =>
      useLocalFileActions({ path: '/Users/me/project/Deck_v8.pptx' }),
    );

    expect(result.current.canPreview).toBe(true);
    result.current.handleClick!();

    expect(useChatStore.getState().openLocalFiles).toEqual([
      {
        allowExternalFilePreview: false,
        filePath: '/Users/me/project/Deck_v8.pptx',
        id: createLocalFileTabId({
          filePath: '/Users/me/project/Deck_v8.pptx',
          workingDirectory: '/Users/me/project',
        }),
        workingDirectory: '/Users/me/project',
      },
    ]);
    expect(useChatStore.getState().showPortal).toBe(true);
    expect(openLocalFileOrFolder).not.toHaveBeenCalled();
  });

  it('marks files outside the current workspace as external previews', () => {
    setWorkingDirectory('/Users/me/project');

    const { result } = renderHook(() => useLocalFileActions({ path: '/tmp/demo.html' }));

    result.current.handleClick!();

    expect(useChatStore.getState().openLocalFiles).toEqual([
      {
        allowExternalFilePreview: true,
        filePath: '/tmp/demo.html',
        id: createLocalFileTabId({ filePath: '/tmp/demo.html', workingDirectory: '/tmp' }),
        workingDirectory: '/tmp',
      },
    ]);
  });

  it('keeps opening directories in the system instead of the portal', () => {
    setWorkingDirectory('/Users/me/project');

    const { result } = renderHook(() =>
      useLocalFileActions({ isDirectory: true, path: '/Users/me/project/docs' }),
    );

    expect(result.current.canPreview).toBe(false);
    result.current.handleClick!();

    expect(openLocalFileOrFolder).toHaveBeenCalledWith('/Users/me/project/docs', true);
    expect(useChatStore.getState().openLocalFiles).toHaveLength(0);
  });

  it('exposes no click action in readonly mode (share pages)', () => {
    setWorkingDirectory('/Users/me/project');

    const { result } = renderHook(() =>
      useLocalFileActions({ path: '/Users/me/project/Deck_v8.pptx', readonly: true }),
    );

    expect(result.current.canPreview).toBe(false);
    expect(result.current.handleClick).toBeUndefined();
  });
});
