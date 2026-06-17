import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './index';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'agent-1',
    canCurrentAgentPublishToCommunity: true,
    config: {
      model: 'gpt-4o',
      plugins: ['lobe-web-browsing'],
      provider: 'openai',
    },
    isCurrentAgentHeterogeneous: false,
    meta: {
      description: 'Test description',
      tags: ['test'],
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
    status: 'ACTIVE',
    isLoading: false,
    signIn: vi.fn(),
  },
  marketPublish: {
    checkOwnership: vi.fn(),
    isPublishing: false,
    publish: vi.fn(),
  },
  navigate: vi.fn(),
  profileState: {
    editor: undefined as { getDocument: (format: string) => string | undefined } | undefined,
    lockState: { holderId: null as string | null, lockedByOther: false, pending: false },
  },
  versionReviewStatus: {
    isUnderReview: false,
  },
}));

vi.mock('@lobechat/const', () => ({
  INBOX_SESSION_ID: 'inbox',
  isDesktop: false,
}));

interface MockDropdownItem {
  children?: MockDropdownItem[];
  key?: string;
  label?: ReactNode;
  onClick?: () => void;
  type?: string;
}

const renderMenuItems = (items: MockDropdownItem[]) =>
  items
    .filter((item) => item.type !== 'divider')
    .map((item) => (
      <div key={item.key}>
        <button type="button" onClick={item.onClick}>
          {item.label}
        </button>
        {item.children && <div>{renderMenuItems(item.children)}</div>}
      </div>
    ));

const getLatestExportedBlob = () => vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button aria-label="more" type="button" />,
  DropdownMenu: ({
    children,
    items = [],
  }: PropsWithChildren<{
    items?: MockDropdownItem[];
  }>) => (
    <div>
      {children}
      <div data-testid="agent-profile-menu">{renderMenuItems(items)}</div>
    </div>
  ),
  Flexbox: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/icons', () => ({
  ShapesUploadIcon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
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
  Download: () => null,
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
  useParams: () => ({ aid: 'agent-1' }),
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
  agentByIdSelectors: {
    getAgentSystemRoleById: () => (state: typeof mocks.agentState) => state.systemRole,
    isAgentHeterogeneousById: () => (state: typeof mocks.agentState) =>
      state.isCurrentAgentHeterogeneous,
  },
  agentSelectors: {
    canCurrentAgentPublishToCommunity: (state: typeof mocks.agentState) =>
      state.canCurrentAgentPublishToCommunity,
    getAgentConfigById: () => (state: typeof mocks.agentState) => state.config,
    getAgentMetaById: () => (state: typeof mocks.agentState) => state.meta,
  },
  builtinAgentSelectors: {
    inboxAgentId: () => undefined,
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

vi.mock('../store', () => ({
  selectors: {
    lockHolderId: (s: typeof mocks.profileState) => s.lockState.holderId,
    lockPending: (s: typeof mocks.profileState) => s.lockState.pending,
    lockedByOther: (s: typeof mocks.profileState) => s.lockState.lockedByOther,
  },
  useProfileStore: (selector: (state: typeof mocks.profileState) => unknown) =>
    selector(mocks.profileState),
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
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:agent-profile');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    mocks.agentState.canCurrentAgentPublishToCommunity = true;
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.profileState.editor = undefined;
  });

  it('should show the community publish action for normal agents', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'publishToCommunity' })).toBeInTheDocument();
  });

  it('should show the markdown export action', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'pageEditor.menu.export' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'pageEditor.menu.export.markdown' }),
    ).toBeInTheDocument();
  });

  it('should export the current agent profile as markdown', async () => {
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'pageEditor.menu.export.markdown' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    const exportedBlob = getLatestExportedBlob();
    await expect(exportedBlob.text()).resolves.toContain('# Test Agent');
    await expect(exportedBlob.text()).resolves.toContain('You are helpful.');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:agent-profile');
  });

  it('should preserve an empty prompt from the mounted editor when exporting markdown', async () => {
    mocks.profileState.editor = {
      getDocument: vi.fn().mockReturnValue(''),
    };

    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'pageEditor.menu.export.markdown' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    const exportedBlob = getLatestExportedBlob();
    const exportedMarkdown = await exportedBlob.text();

    expect(exportedMarkdown).toContain('# Test Agent');
    expect(exportedMarkdown).not.toContain('You are helpful.');
    expect(exportedMarkdown).not.toContain('settingAgent.prompt.title');
  });

  it('should hide the community publish action for heterogeneous and platform agents', () => {
    mocks.agentState.canCurrentAgentPublishToCommunity = false;
    mocks.agentState.isCurrentAgentHeterogeneous = true;

    render(<Header />);

    expect(screen.queryByRole('button', { name: 'publishToCommunity' })).not.toBeInTheDocument();
  });
});
