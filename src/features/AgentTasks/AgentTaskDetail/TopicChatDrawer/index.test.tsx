/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
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
  permission: {
    allowed: true,
    reason: 'requires member',
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

const serializeSize = (size: unknown) =>
  size === undefined ? '' : typeof size === 'string' ? size : JSON.stringify(size);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    disabled,
    icon,
    onClick,
    size,
    title,
  }: {
    disabled?: boolean;
    icon?: { name?: string };
    onClick?: () => void;
    size?: unknown;
    title?: string;
  }) => (
    <button
      data-icon={icon?.name}
      data-size={serializeSize(size)}
      data-testid="header-action-icon"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {title}
    </button>
  ),
  copyToClipboard: vi.fn(),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Flexbox: ({
    children,
    flex,
    style,
  }: {
    children?: ReactNode;
    flex?: CSSProperties['flex'];
    style?: CSSProperties;
  }) => <div style={{ flex, ...style }}>{children}</div>,
  Freeze: ({ children }: { children?: ReactNode; frozen?: boolean }) => <>{children}</>,
  Text: ({ children, style }: { children?: ReactNode; style?: CSSProperties }) => (
    <span style={style}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  FloatingPanel: ({
    actions,
    children,
    height,
    minHeight,
    minWidth,
    open,
    placement,
    resizable = true,
    styles,
    title,
    width,
  }: {
    actions?: ReactNode;
    children?: ReactNode;
    height?: unknown;
    minHeight?: number;
    minWidth?: number;
    open?: boolean;
    placement?: string;
    resizable?: boolean;
    styles?: { body?: CSSProperties; title?: CSSProperties };
    title?: ReactNode;
    width?: unknown;
  }) =>
    open ? (
      <div
        data-height={serializeSize(height)}
        data-min-height={serializeSize(minHeight)}
        data-min-width={serializeSize(minWidth)}
        data-placement={placement}
        data-resizable={String(resizable)}
        data-testid="topic-panel"
        data-width={serializeSize(width)}
      >
        <div data-testid="panel-title-slot" style={styles?.title}>
          {title}
        </div>
        <div data-testid="panel-actions-slot">{actions}</div>
        <button data-testid="panel-close-icon" />
        <div data-testid="panel-body-slot" style={styles?.body}>
          {children}
        </div>
      </div>
    ) : null,
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

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permission.allowed, reason: mocks.permission.reason }),
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
    mocks.permission.allowed = true;
    mocks.serverConfigState.serverConfig.enableBusinessFeatures = false;
  });

  it('hydrates the task assignee agent config for drawer messages', () => {
    render(<TopicChatDrawer />);

    expect(mocks.agentState.useHydrateAgentConfig).toHaveBeenCalledWith(true, 'agt_assignee');
  });

  it('disables topic sharing for workspace viewers', () => {
    mocks.permission.allowed = false;
    mocks.serverConfigState.serverConfig.enableBusinessFeatures = true;

    const { getByTitle } = render(<TopicChatDrawer />);

    expect(getByTitle('requires member')).toBeDisabled();
  });

  it('constrains long panel titles before the header actions', () => {
    const { getByTestId, getByText } = render(<TopicChatDrawer />);

    const title = getByText('Topic 1');

    expect(title).toHaveStyle({ flex: '0 1 auto', minWidth: '0' });
    expect(title.parentElement).toHaveStyle({ maxWidth: '100%', overflow: 'hidden' });
    expect(getByTestId('panel-title-slot')).toHaveStyle({
      boxSizing: 'border-box',
      maxWidth: '100%',
      overflow: 'hidden',
    });
  });

  it('renders the share button in the floating panel actions slot', () => {
    const { getAllByTestId, getByTestId } = render(<TopicChatDrawer />);

    const icons = getAllByTestId('header-action-icon');
    const moreIcon = icons.find((icon) => !icon.getAttribute('title'));
    const shareIcon = icons.find((icon) => icon.getAttribute('title') === 'share');

    expect(moreIcon).toBeDefined();
    expect(shareIcon).toBeDefined();
    expect(moreIcon!).toHaveAttribute('data-size', 'small');
    expect(shareIcon!).toHaveAttribute('data-size', JSON.stringify({ blockSize: 32, size: 16 }));
    expect(getByTestId('panel-actions-slot')).toContainElement(shareIcon!);
    expect(getByTestId('panel-close-icon')).toBeInTheDocument();
  });

  it('uses a resizable bottom-right floating panel', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('topic-panel')).toHaveAttribute('data-placement', 'bottomRight');
    expect(getByTestId('topic-panel')).toHaveAttribute('data-resizable', 'true');
    expect(getByTestId('topic-panel')).toHaveAttribute('data-width', '640');
    expect(getByTestId('topic-panel')).toHaveAttribute(
      'data-height',
      'min(640px, calc(100dvh - 16px))',
    );
  });
});
