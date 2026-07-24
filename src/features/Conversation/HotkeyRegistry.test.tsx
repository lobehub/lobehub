import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { type UIChatMessage } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationHotkeyBoundary from './ConversationHotkeyBoundary';
import HotkeyRegistry from './HotkeyRegistry';
import { useConversationHotkeyStore } from './hotkeyStore';

const mockUseHotkeyById = vi.fn();
const mockPermissionState = vi.hoisted(() => ({
  permissions: {
    create_content: true,
    edit_own_content: true,
  } as Record<string, boolean>,
}));

interface MockConversationMessage {
  id: string;
  parentId?: string;
  role: UIChatMessage['role'];
  threadId?: string | null;
}

interface MockConversationStore {
  context: { threadId: string | null };
  delAndRegenerateMessage: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  displayMessages: MockConversationMessage[];
  regenerateAssistantMessage: ReturnType<typeof vi.fn>;
  regenerateUserMessage: ReturnType<typeof vi.fn>;
}

let mockConversationStore: MockConversationStore = {
  context: { threadId: null as string | null },
  delAndRegenerateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  displayMessages: [
    { id: 'user-1', role: 'user' },
    { id: 'assistant-1', parentId: 'user-1', role: 'assistant' },
  ],
  regenerateAssistantMessage: vi.fn(),
  regenerateUserMessage: vi.fn(),
};

vi.mock('@/hooks/useHotkeys/useHotkeyById', () => ({
  useHotkeyById: (...args: any[]) => mockUseHotkeyById(...args),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: string) => ({
    allowed: mockPermissionState.permissions[action] ?? true,
    reason: '',
  }),
}));

vi.mock('./store', () => ({
  useConversationStore: (selector: (state: typeof mockConversationStore) => unknown) =>
    selector(mockConversationStore),
}));

describe('HotkeyRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissionState.permissions = {
      create_content: true,
      edit_own_content: true,
    };
    useConversationHotkeyStore.setState({ activeConversationKey: undefined });
    mockConversationStore = {
      context: { threadId: null },
      delAndRegenerateMessage: vi.fn(),
      deleteMessage: vi.fn(),
      displayMessages: [
        { id: 'user-1', role: 'user' },
        { id: 'assistant-1', parentId: 'user-1', role: 'assistant' },
      ],
      regenerateAssistantMessage: vi.fn(),
      regenerateUserMessage: vi.fn(),
    };
  });

  afterEach(() => {
    useConversationHotkeyStore.setState({ activeConversationKey: undefined });
  });

  it('should enable message control hotkeys for the active conversation only', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'main' });

    render(<HotkeyRegistry conversationKey={'main'} />);

    expect(mockUseHotkeyById).toHaveBeenCalledTimes(3);
    expect(mockUseHotkeyById.mock.calls.map((call) => call[0])).toEqual([
      HotkeyEnum.RegenerateMessage,
      HotkeyEnum.DeleteLastMessage,
      HotkeyEnum.DeleteAndRegenerateMessage,
    ]);

    for (const [, , options] of mockUseHotkeyById.mock.calls) {
      expect(options).toMatchObject({
        enableOnContentEditable: true,
        enabled: true,
      });
    }
  });

  it('should disable message control hotkeys for an inactive conversation', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'main' });

    render(<HotkeyRegistry conversationKey={'thread'} />);

    expect(mockUseHotkeyById).toHaveBeenCalledTimes(3);

    for (const [, , options] of mockUseHotkeyById.mock.calls) {
      expect(options).toMatchObject({
        enableOnContentEditable: true,
        enabled: false,
      });
    }
  });

  it('should gate destructive hotkeys by content permissions', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'main' });
    mockPermissionState.permissions = {
      create_content: false,
      edit_own_content: true,
    };

    const { unmount } = render(<HotkeyRegistry conversationKey={'main'} />);

    expect(
      mockUseHotkeyById.mock.calls.find(
        ([hotkeyId]) => hotkeyId === HotkeyEnum.RegenerateMessage,
      )?.[2],
    ).toMatchObject({ enabled: false });
    expect(
      mockUseHotkeyById.mock.calls.find(
        ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteLastMessage,
      )?.[2],
    ).toMatchObject({ enabled: true });
    expect(
      mockUseHotkeyById.mock.calls.find(
        ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteAndRegenerateMessage,
      )?.[2],
    ).toMatchObject({ enabled: false });

    unmount();
    vi.clearAllMocks();
    mockPermissionState.permissions = {
      create_content: true,
      edit_own_content: false,
    };

    render(<HotkeyRegistry conversationKey={'main'} />);

    expect(
      mockUseHotkeyById.mock.calls.find(
        ([hotkeyId]) => hotkeyId === HotkeyEnum.RegenerateMessage,
      )?.[2],
    ).toMatchObject({ enabled: true });
    expect(
      mockUseHotkeyById.mock.calls.find(
        ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteLastMessage,
      )?.[2],
    ).toMatchObject({ enabled: false });
    expect(
      mockUseHotkeyById.mock.calls.find(
        ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteAndRegenerateMessage,
      )?.[2],
    ).toMatchObject({ enabled: true });
  });

  it('should fall back to regenerating the last user message when no assistant message exists', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'main' });
    mockConversationStore = {
      ...mockConversationStore,
      displayMessages: [{ id: 'user-2', role: 'user' }],
    };

    render(<HotkeyRegistry conversationKey={'main'} />);

    const regenerateCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.RegenerateMessage,
    );

    expect(regenerateCall).toBeDefined();

    const callback = regenerateCall?.[1];
    expect(typeof callback).toBe('function');

    callback();

    expect(mockConversationStore.regenerateUserMessage).toHaveBeenCalledWith('user-2');
    expect(mockConversationStore.regenerateAssistantMessage).not.toHaveBeenCalled();
  });

  it('should treat delete-and-regenerate as regenerate when the last message is a user message', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'main' });
    mockConversationStore = {
      ...mockConversationStore,
      displayMessages: [{ id: 'user-3', role: 'user' }],
    };

    render(<HotkeyRegistry conversationKey={'main'} />);

    const deleteAndRegenerateCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteAndRegenerateMessage,
    );

    expect(deleteAndRegenerateCall).toBeDefined();

    const callback = deleteAndRegenerateCall?.[1];
    expect(typeof callback).toBe('function');

    callback();

    expect(mockConversationStore.regenerateUserMessage).toHaveBeenCalledWith('user-3');
    expect(mockConversationStore.delAndRegenerateMessage).not.toHaveBeenCalled();
  });

  it('should target only messages from the active thread', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'thread' });
    mockConversationStore = {
      ...mockConversationStore,
      context: { threadId: 'thread-1' },
      displayMessages: [
        { id: 'parent-user', role: 'user' },
        { id: 'thread-user', role: 'user', threadId: 'thread-1' },
        {
          id: 'thread-assistant',
          parentId: 'thread-user',
          role: 'assistant',
          threadId: 'thread-1',
        },
        {
          id: 'other-thread-assistant',
          parentId: 'other-thread-user',
          role: 'assistant',
          threadId: 'thread-2',
        },
      ],
    };

    render(<HotkeyRegistry conversationKey={'thread'} />);

    const regenerateCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.RegenerateMessage,
    );
    const deleteLastCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteLastMessage,
    );
    const deleteAndRegenerateCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteAndRegenerateMessage,
    );

    regenerateCall?.[1]();
    deleteLastCall?.[1]();
    deleteAndRegenerateCall?.[1]();

    expect(mockConversationStore.regenerateAssistantMessage).toHaveBeenCalledWith(
      'thread-assistant',
    );
    expect(mockConversationStore.deleteMessage).toHaveBeenCalledWith('thread-assistant');
    expect(mockConversationStore.delAndRegenerateMessage).toHaveBeenCalledWith('thread-assistant');
  });

  it('should skip default and system messages when selecting hotkey targets', () => {
    useConversationHotkeyStore.setState({ activeConversationKey: 'main' });
    mockConversationStore = {
      ...mockConversationStore,
      displayMessages: [
        { id: 'assistant-1', role: 'assistant' },
        { id: 'default', role: 'assistant' },
        { id: 'system-1', role: 'system' },
      ],
    };

    render(<HotkeyRegistry conversationKey={'main'} />);

    const regenerateCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.RegenerateMessage,
    );
    const deleteLastCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteLastMessage,
    );
    const deleteAndRegenerateCall = mockUseHotkeyById.mock.calls.find(
      ([hotkeyId]) => hotkeyId === HotkeyEnum.DeleteAndRegenerateMessage,
    );

    regenerateCall?.[1]();
    deleteLastCall?.[1]();
    deleteAndRegenerateCall?.[1]();

    expect(mockConversationStore.regenerateAssistantMessage).toHaveBeenCalledWith('assistant-1');
    expect(mockConversationStore.deleteMessage).toHaveBeenCalledWith('assistant-1');
    expect(mockConversationStore.delAndRegenerateMessage).toHaveBeenCalledWith('assistant-1');
  });
});

describe('ConversationHotkeyBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationHotkeyStore.setState({ activeConversationKey: undefined });
  });

  afterEach(() => {
    useConversationHotkeyStore.setState({ activeConversationKey: undefined });
  });

  it('should switch the active conversation when focus moves between boundaries', async () => {
    render(
      <>
        <ConversationHotkeyBoundary conversationKey={'main'}>
          <button type={'button'}>main</button>
        </ConversationHotkeyBoundary>
        <ConversationHotkeyBoundary conversationKey={'thread'}>
          <button type={'button'}>thread</button>
        </ConversationHotkeyBoundary>
        <button type={'button'}>outside</button>
      </>,
    );

    expect(useConversationHotkeyStore.getState().activeConversationKey).toBe('main');

    const threadButton = screen.getByRole('button', { name: 'thread' });
    const outsideButton = screen.getByRole('button', { name: 'outside' });

    fireEvent.pointerDown(threadButton);
    fireEvent.focus(threadButton);

    expect(useConversationHotkeyStore.getState().activeConversationKey).toBe('thread');

    fireEvent.blur(threadButton);
    fireEvent.focus(outsideButton);

    await waitFor(() => {
      expect(useConversationHotkeyStore.getState().activeConversationKey).toBeUndefined();
    });
  });

  it('should clear the active conversation when clicking a non-focusable element outside', async () => {
    render(
      <>
        <ConversationHotkeyBoundary conversationKey={'main'}>
          <button type={'button'}>main</button>
        </ConversationHotkeyBoundary>
        <div>outside</div>
      </>,
    );

    expect(useConversationHotkeyStore.getState().activeConversationKey).toBe('main');

    fireEvent.pointerDown(screen.getByText('outside'));

    await waitFor(() => {
      expect(useConversationHotkeyStore.getState().activeConversationKey).toBeUndefined();
    });
  });
});
