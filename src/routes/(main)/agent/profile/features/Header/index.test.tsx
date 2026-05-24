import { render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './index';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'agent-1',
    canCurrentAgentPublishToCommunity: true,
    isCurrentAgentHeterogeneous: false,
    meta: {
      title: 'Test Agent',
    },
    systemRole: 'You are helpful.',
  },
  globalState: {
    isStatusInit: true,
    showAgentBuilderPanel: false,
    toggleAgentBuilderPanel: vi.fn(),
  },
  homeState: {
    removeAgent: vi.fn(),
  },
  marketAuth: {
    isAuthenticated: true,
    isLoading: false,
    signIn: vi.fn(),
  },
  marketPublish: {
    checkOwnership: vi.fn(),
    isPublishing: false,
    publish: vi.fn(),
  },
  navigate: vi.fn(),
  versionReviewStatus: {
    isUnderReview: false,
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button aria-label="more" type="button" />,
  DropdownMenu: ({
    children,
    items = [],
  }: PropsWithChildren<{
    items?: Array<{ key?: string; label?: ReactNode; type?: string }>;
  }>) => (
    <div>
      {children}
      <div data-testid="agent-profile-menu">
        {items
          .filter((item) => item.type !== 'divider')
          .map((item) => (
            <button key={item.key} type="button">
              {item.label}
            </button>
          ))}
      </div>
    </div>
  ),
  Flexbox: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/icons', () => ({
  ShapesUploadIcon: () => null,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      modal: {
        confirm: vi.fn(),
      },
    }),
  },
  Modal: {
    confirm: vi.fn(),
  },
}));

vi.mock('lucide-react', () => ({
  BotMessageSquareIcon: () => null,
  MoreHorizontal: () => null,
  Settings2Icon: () => null,
  Trash: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/const/layoutTokens', () => ({
  DESKTOP_HEADER_ICON_SMALL_SIZE: 24,
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: { left?: ReactNode; right?: ReactNode }) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));

vi.mock('@/features/RightPanel/ToggleRightPanelButton', () => ({
  default: () => <button type="button">agentBuilder</button>,
}));

vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  useMarketAuth: () => mocks.marketAuth,
}));

vi.mock('@/layout/AuthProvider/MarketAuth/errors', () => ({
  resolveMarketAuthError: () => ({ code: 'unknown' }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    canCurrentAgentPublishToCommunity: (state: typeof mocks.agentState) =>
      state.canCurrentAgentPublishToCommunity,
    currentAgentMeta: (state: typeof mocks.agentState) => state.meta,
    currentAgentSystemRole: (state: typeof mocks.agentState) => state.systemRole,
    isCurrentAgentHeterogeneous: (state: typeof mocks.agentState) =>
      state.isCurrentAgentHeterogeneous,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof mocks.globalState) => unknown) =>
    selector(mocks.globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    isStatusInit: (state: typeof mocks.globalState) => state.isStatusInit,
    showAgentBuilderPanel: (state: typeof mocks.globalState) => state.showAgentBuilderPanel,
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.homeState) => unknown) => selector(mocks.homeState),
}));

vi.mock('./AgentForkTag', () => ({
  default: () => null,
}));

vi.mock('./AgentPublishButton/ForkConfirmModal', () => ({
  default: () => null,
}));

vi.mock('./AgentPublishButton/PublishResultModal', () => ({
  default: () => null,
}));

vi.mock('./AgentPublishButton/useMarketPublish', () => ({
  useMarketPublish: () => mocks.marketPublish,
}));

vi.mock('./AgentStatusTag', () => ({
  default: () => null,
}));

vi.mock('./AutoSaveHint', () => ({
  default: () => null,
}));

vi.mock('./AgentVersionReviewTag', () => ({
  default: () => null,
  useVersionReviewStatus: () => mocks.versionReviewStatus,
}));

describe('Agent profile Header', () => {
  beforeEach(() => {
    mocks.agentState.canCurrentAgentPublishToCommunity = true;
    mocks.agentState.isCurrentAgentHeterogeneous = false;
  });

  it('should show the community publish action for normal agents', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'publishToCommunity' })).toBeInTheDocument();
  });

  it('should hide the community publish action for heterogeneous and platform agents', () => {
    mocks.agentState.canCurrentAgentPublishToCommunity = false;
    mocks.agentState.isCurrentAgentHeterogeneous = true;

    render(<Header />);

    expect(screen.queryByRole('button', { name: 'publishToCommunity' })).not.toBeInTheDocument();
  });
});
