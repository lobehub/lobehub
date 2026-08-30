/**
 * @vitest-environment happy-dom
 */
import type { TaskDetailActivity } from '@lobechat/types';
import { fireEvent, render } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';

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
  navigate: vi.fn(),
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
        ] as TaskDetailActivity[],
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

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyToClipboard: vi.fn(),
  DropdownMenu: ({
    children,
    items,
  }: {
    children?: ReactNode;
    items?: { key: string; label?: ReactNode; onClick?: () => void; type?: string }[];
  }) => (
    <>
      {children}
      {items?.map((item) =>
        item.type === 'divider' ? null : (
          <button key={item.key} onClick={item.onClick}>
            {item.label}
          </button>
        ),
      )}
    </>
  ),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
    styles?: { body?: CSSProperties; panel?: CSSProperties; title?: CSSProperties };
    title?: ReactNode;
    width?: unknown;
  }) =>
    open ? (
      <div
        data-height={serializeSize(height)}
        data-min-height={serializeSize(minHeight)}
        data-min-width={serializeSize(minWidth)}
        data-panel-background={serializeSize(styles?.panel?.background)}
        data-placement={placement}
        data-resizable={String(resizable)}
        data-testid="topic-panel"
        data-width={serializeSize(width)}
        style={styles?.panel}
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

vi.mock('@/features/Conversation/ChatList', () => ({
  default: () => <div data-testid="chat-list" />,
}));

vi.mock('@/features/Conversation/ConversationProvider', () => ({
  ConversationProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/Conversation/Messages', () => ({
  default: ({ id }: { id: string }) => <div data-testid="message-item">{id}</div>,
}));

vi.mock('@/features/Conversation/Markdown/plugins/Task', () => ({
  TaskCardScopeProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ShareModal', () => ({
  useShareModal: () => ({
    openShareModal: vi.fn(),
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
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

vi.mock('../../features/AssigneeAvatar', () => ({
  default: ({ agentId, size }: { agentId?: string; size?: number }) => (
    <span data-agent-id={agentId} data-size={size} data-testid="assignee-avatar" />
  ),
}));

vi.mock('./FeedbackInput', () => ({
  default: ({
    defaultExpanded,
    disableCollapse,
  }: {
    defaultExpanded?: boolean;
    disableCollapse?: boolean;
  }) => (
    <div
      data-default-expanded={String(Boolean(defaultExpanded))}
      data-disable-collapse={String(Boolean(disableCollapse))}
      data-testid="feedback-input"
    />
  ),
}));

describe('TopicChatDrawer', () => {
  beforeEach(() => {
    mocks.agentState.useHydrateAgentConfig.mockClear();
    mocks.chatState.replaceMessages.mockClear();
    mocks.navigate.mockClear();
    mocks.taskState.closeTopicDrawer.mockClear();
    mocks.taskState.activeTopicDrawerTopicId = 'topic-1';
    mocks.taskState.taskDetailMap['T-1'].activities[0] = {
      id: 'topic-1',
      status: 'completed',
      time: '2026-04-29T00:00:00.000Z',
      title: 'Topic 1',
      type: 'topic',
    };
    mocks.permission.allowed = true;
    mocks.serverConfigState.serverConfig.enableBusinessFeatures = false;
    vi.mocked(useGatewayReconnect).mockClear();
  });

  // The run drawer also mounts on the home inbox, where the chat store has no
  // active agent — reconnecting against it would stream the run into a bucket
  // this panel never reads, so the run's own agent has to be passed down.
  it('reconnects a running topic against the drawer agent', () => {
    mocks.taskState.taskDetailMap['T-1'].activities[0] = {
      id: 'topic-1',
      runningOperation: {
        assistantMessageId: 'ast-1',
        heteroType: 'claude-code',
        operationId: 'op-1',
      },
      status: 'running',
      time: '2026-04-29T00:00:00.000Z',
      title: 'Topic 1',
      type: 'topic',
    };

    render(<TopicChatDrawer />);

    expect(useGatewayReconnect).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ heteroType: 'claude-code', operationId: 'op-1' }),
      'agt_assignee',
    );
  });

  it('hydrates the task assignee agent config for drawer messages', () => {
    render(<TopicChatDrawer />);

    expect(mocks.agentState.useHydrateAgentConfig).toHaveBeenCalledWith(true, 'agt_assignee');
  });

  it('keeps the floating drawer reply input collapsed by default', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('feedback-input')).toHaveAttribute('data-default-expanded', 'false');
    expect(getByTestId('feedback-input')).toHaveAttribute('data-disable-collapse', 'false');
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

  it('shows the assignee avatar in the topic header', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('assignee-avatar')).toHaveAttribute('data-agent-id', 'agt_assignee');
    expect(getByTestId('assignee-avatar')).toHaveAttribute('data-size', '20');
  });

  it('uses the container background for the conversation panel', () => {
    const { getByTestId } = render(<TopicChatDrawer />);

    expect(getByTestId('topic-panel')).toHaveAttribute(
      'data-panel-background',
      'var(--ant-color-bg-container)',
    );
  });

  it('renders the share button in the floating panel actions slot', () => {
    const { getAllByTestId, getByTestId } = render(<TopicChatDrawer />);

    const icons = getAllByTestId('header-action-icon');
    const moreIcon = icons.find((icon) => !icon.getAttribute('title'));
    const expandIcon = icons.find(
      (icon) => icon.getAttribute('title') === 'taskDetail.topicDrawer.expand',
    );
    const shareIcon = icons.find((icon) => icon.getAttribute('title') === 'share');

    expect(moreIcon).toBeDefined();
    expect(expandIcon).toBeDefined();
    expect(shareIcon).toBeDefined();
    expect(moreIcon!).toHaveAttribute('data-size', 'small');
    expect(shareIcon!).toHaveAttribute('data-size', JSON.stringify({ blockSize: 32, size: 16 }));
    expect(getByTestId('panel-actions-slot')).toContainElement(shareIcon!);
    expect(getByTestId('panel-close-icon')).toBeInTheDocument();
  });

  it('expands the conversation into a full-height reading panel', () => {
    const { getByTestId, getByTitle } = render(<TopicChatDrawer />);

    fireEvent.click(getByTitle('taskDetail.topicDrawer.expand'));

    expect(getByTestId('topic-panel')).toHaveAttribute(
      'data-width',
      'min(960px, calc(100vw - 16px))',
    );
    expect(getByTestId('topic-panel')).toHaveAttribute('data-height', 'calc(100dvh - 16px)');
    expect(getByTitle('taskDetail.topicDrawer.collapse')).toBeInTheDocument();
  });

  it('opens the run in its Agent conversation', () => {
    const { getByText } = render(<TopicChatDrawer />);

    fireEvent.click(getByText('taskDetail.topicMenu.openAgentTopic'));

    expect(mocks.taskState.closeTopicDrawer).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_assignee/topic-1');
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
