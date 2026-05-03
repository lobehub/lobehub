/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicChatDrawer from './index';

const mocks = vi.hoisted(() => ({
  agentState: {
    useHydrateAgentConfig: vi.fn(),
  },
  chatState: {
    dbMessagesMap: {} as Record<string, unknown[]>,
    replaceMessages: vi.fn(),
  },
  serverConfigState: {
    serverConfig: {
      enableBusinessFeatures: false,
    },
  },
  taskState: {
    activeTaskId: 'T-1',
    activeTopicDrawerTopicId: 'topic-1',
    closeTopicDrawer: vi.fn(),
    useFetchTaskDetail: vi.fn(),
    taskDetailMap: {
      'T-1': {
        activities: [
          {
            id: 'topic-1',
            status: 'completed',
            time: '2026-04-29T00:00:00.000Z',
            title: 'Topic 1',
            type: 'topic',
          },
        ],
        agentId: 'agt_assignee',
        identifier: 'T-1',
        instruction: 'Do the task',
        status: 'completed',
      },
    },
  },
  userState: {
    isSignedIn: true,
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: () => void }) => <button onClick={onClick} />,
  copyToClipboard: vi.fn(),
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="topic-drawer">{children}</div> : null,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorBorderSecondary: '#ddd',
  },
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function DynamicComponent({ children }: { children?: ReactNode }) {
      return <>{children}</>;
    },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/Conversation', () => ({
  ChatList: () => <div data-testid="chat-list" />,
  ConversationProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  MessageItem: ({ id }: { id: string }) => <div data-testid="message-item">{id}</div>,
}));

vi.mock('@/features/Conversation/Markdown/plugins/Task', () => ({
  TaskCardScopeProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ShareModal', () => ({
  useShareModal: () => ({
    openShareModal: vi.fn(),
  }),
}));

vi.mock('@/hooks/useGatewayReconnect', () => ({
  useGatewayReconnect: vi.fn(),
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => undefined,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof mocks.chatState) => unknown) => selector(mocks.chatState),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof mocks.serverConfigState) => unknown) =>
    selector(mocks.serverConfigState),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: typeof mocks.taskState) => unknown) => selector(mocks.taskState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: () => 'topic-chat-key',
}));

vi.mock('../TopicStatusIcon', () => ({
  default: () => <span data-testid="topic-status-icon" />,
}));

vi.mock('./FeedbackInput', () => ({
  default: () => <div data-testid="feedback-input" />,
}));

describe('TopicChatDrawer', () => {
  beforeEach(() => {
    mocks.agentState.useHydrateAgentConfig.mockClear();
    mocks.chatState.replaceMessages.mockClear();
    mocks.taskState.closeTopicDrawer.mockClear();
    mocks.taskState.activeTopicDrawerTopicId = 'topic-1';
  });

  it('hydrates the task assignee agent config for drawer messages', () => {
    render(<TopicChatDrawer />);

    expect(mocks.agentState.useHydrateAgentConfig).toHaveBeenCalledWith(true, 'agt_assignee');
  });
});
