import type * as LobeChatConst from '@lobechat/const';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as LucideReact from 'lucide-react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './index';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'agent-1',
    authorId: undefined as string | undefined,
    config: {
      model: 'gpt-4o',
      plugins: ['lobe-web-browsing'],
      provider: 'openai',
    },
    isInbox: false,
    isCurrentAgentHeterogeneous: false,
    meta: {
      description: 'Test description',
      tags: ['test'],
      title: 'Test Agent',
    },
    createdAt: undefined as Date | undefined,
    systemRole: 'You are helpful.',
    visibility: 'public' as 'private' | 'public',
  },
  globalState: {
    isStatusInit: true,
    showAgentBuilderPanel: false,
    toggleAgentBuilderPanel: vi.fn(),
  },
  homeState: {
    removeAgent: vi.fn(),
  },
  navigate: vi.fn(),
  profileState: {
    editor: undefined as { getDocument: (format: string) => string | undefined } | undefined,
    lockState: { holderId: null as string | null, lockedByOther: false, pending: false },
  },
  resourcePermissionMenuItemArgs: [] as unknown[],
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeChatConst>()),
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

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
}));

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    App: Record<string, unknown>;
    Modal: Record<string, unknown>;
  } & Record<string, unknown>;

  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({
        modal: {
          confirm: vi.fn(),
        },
      }),
    },
    Modal: {
      ...actual.Modal,
      confirm: vi.fn(),
    },
  };
});

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof LucideReact>()),
  BotMessageSquareIcon: () => null,
  Circle: () => null,
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

vi.mock('react-router', () => ({
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

vi.mock('@/features/AgentBreadcrumb', () => ({
  default: () => null,
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => true,
}));

vi.mock('@/features/ResourcePermission/AccessLevelTag', () => ({
  default: ({ resourceId }: { resourceId?: string }) => (
    <span data-testid="access-level-resource-id">{resourceId}</span>
  ),
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true, canManageResource: true }),
}));

vi.mock('@/features/ResourcePermission/useResourcePermissionMenuItem', () => ({
  useResourcePermissionMenuItem: (...args: unknown[]) => {
    mocks.resourcePermissionMenuItemArgs = args;
    return { key: 'member-permissions', label: 'Members: Can use' };
  },
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({
    left,
    right,
    styles,
  }: {
    left?: ReactNode;
    right?: ReactNode;
    styles?: { left?: CSSProperties };
  }) => (
    <header>
      <div data-testid="nav-header-left" style={styles?.left}>
        {left}
      </div>
      {right}
    </header>
  ),
}));

vi.mock('@/features/RightPanel/ToggleRightPanelButton', () => ({
  default: () => <button type="button">agentBuilder</button>,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentAuthorId: (state: typeof mocks.agentState) => state.authorId,
    currentAgentConfig: (state: typeof mocks.agentState) => state.config,
    currentAgentCreatedAt: (state: typeof mocks.agentState) => state.createdAt,
    currentAgentMeta: (state: typeof mocks.agentState) => state.meta,
    currentAgentSystemRole: (state: typeof mocks.agentState) => state.systemRole,
    currentAgentVisibility: (state: typeof mocks.agentState) => state.visibility,
    isCurrentAgentHeterogeneous: (state: typeof mocks.agentState) =>
      state.isCurrentAgentHeterogeneous,
  },
  builtinAgentSelectors: {
    isInboxAgent: (state: typeof mocks.agentState) => state.isInbox,
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

vi.mock('./AgentStatusTag', () => ({
  default: () => null,
}));

vi.mock('./AgentVersionReviewTag', () => ({
  default: () => null,
}));

describe('Agent profile Header', () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:agent-profile');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.agentState.isInbox = false;
    mocks.agentState.systemRole = 'You are helpful.';
    mocks.agentState.visibility = 'public';
    mocks.resourcePermissionMenuItemArgs = [];
    mocks.globalState.showAgentBuilderPanel = false;
    mocks.profileState.editor = undefined;
  });

  it.each([false, true])(
    'keeps the breadcrumb aligned with the left content inset when builder expanded is %s',
    (showAgentBuilderPanel) => {
      mocks.globalState.showAgentBuilderPanel = showAgentBuilderPanel;

      render(<Header />);

      expect(screen.getByTestId('nav-header-left').style.paddingInlineStart).toBe('8px');
    },
  );

  it('should show the markdown export action', () => {
    render(<Header />);

    expect(screen.getByRole('button', { name: 'pageEditor.menu.export' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'pageEditor.menu.export.markdown' }),
    ).toBeInTheDocument();
  });

  it('shows workspace resource permission controls for the LobeAI inbox agent', () => {
    mocks.agentState.isInbox = true;

    render(<Header />);

    expect(mocks.resourcePermissionMenuItemArgs).toEqual(['agent', 'agent-1']);
    expect(screen.getByRole('button', { name: 'Members: Can use' })).toBeInTheDocument();
    expect(screen.getByTestId('access-level-resource-id')).toHaveTextContent('agent-1');
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

  it('should ignore the hidden editor when exporting heterogeneous agent markdown', async () => {
    const getDocument = vi.fn().mockReturnValue('');
    mocks.agentState.isCurrentAgentHeterogeneous = true;
    mocks.profileState.editor = { getDocument };

    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'pageEditor.menu.export.markdown' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    const exportedBlob = getLatestExportedBlob();
    const exportedMarkdown = await exportedBlob.text();

    expect(getDocument).not.toHaveBeenCalled();
    expect(exportedMarkdown).toContain('You are helpful.');
  });
});
