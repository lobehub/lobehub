import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentWorkingSidebar from '../index';

// ─── captured RightPanel props ────────────────────────────────────────────────
// The real RightPanel is a controlled DraggablePanel; here we stub it so the test
// can read back the `width` it receives and drive its `onSizeChange` directly.

interface CapturedRightPanelProps {
  children?: ReactNode;
  defaultWidth?: number | string;
  maxWidth?: number | string;
  onSizeChange?: (size?: { height?: number | string; width?: number | string }) => void;
  width?: number | string;
}

const rightPanel = vi.hoisted(() => ({
  current: undefined as CapturedRightPanelProps | undefined,
}));

const agentStore = vi.hoisted(() => ({
  activeAgentId: undefined as string | undefined,
  isHeterogeneous: false,
  rawAgencyConfig: undefined as
    { boundDeviceId?: string; executionTarget?: 'device' | 'local' } | undefined,
}));

const effectiveConfig = vi.hoisted(() => ({
  agencyConfig: undefined as
    { boundDeviceId?: string; executionTarget?: 'device' | 'local' } | undefined,
  workspaceScoped: false,
}));

const filesProps = vi.hoisted(() => ({
  current: undefined as { deviceId?: string; workingDirectory: string } | undefined,
}));

const reviewState = vi.hoisted(() => ({
  repoType: undefined as string | undefined,
  setRepoType: undefined as ((repoType?: string) => void) | undefined,
  showTree: false,
  workingDirectory: undefined as string | undefined,
}));

const businessTabs = vi.hoisted(() => ({
  current: [] as { key: string; label: string; pane: ReactNode }[],
}));

const paramsSectionState = vi.hoisted(() => ({
  pending: new Promise<never>(() => undefined),
  suspend: false,
}));

const localStorageState = vi.hoisted(() => ({
  openTabsByContext: {} as Record<string, string[]>,
  pinnedTabsByAgent: {} as Record<string, string[]>,
}));

const dropdownMenuState = vi.hoisted(() => ({
  onOpenChangeComplete: undefined as ((open: boolean) => void) | undefined,
}));

const globalStore = vi.hoisted(() => ({
  updateSystemStatus: vi.fn(),
  toggleRightPanel: vi.fn(),
  toggleTerminalPanel: vi.fn(),
  setWorkingSidebarTab: vi.fn(),
  status: {
    showRightPanel: true,
    workingSidebarTab: 'params' as string | undefined,
    workingSidebarTabRequest: undefined as { nonce: number; tab: string } | undefined,
    workingSidebarWidth: 360 as number | undefined,
  },
}));

vi.mock('@/features/RightPanel', () => ({
  default: (props: CapturedRightPanelProps) => {
    rightPanel.current = props;
    return <div data-testid="right-panel">{props.children}</div>;
  },
}));

// ─── stub every downstream dependency so the sidebar renders deterministically ──

vi.mock('../Files', () => ({
  default: (props: { deviceId?: string; workingDirectory: string }) => {
    filesProps.current = props;
    return <div data-testid="files" />;
  },
}));
vi.mock('../Review', () => ({ default: () => <div /> }));
vi.mock('../ProgressSection', () => ({ default: () => <div /> }));
vi.mock('../ResourcesSection', () => ({ default: () => <div /> }));
vi.mock('../ParamsSection', () => ({
  default: () => {
    if (paramsSectionState.suspend) throw paramsSectionState.pending;
    return <div data-testid="params-section" />;
  },
}));
vi.mock('../WorksSection', () => ({ default: () => <div /> }));
vi.mock('../Overview', () => ({
  default: ({ onOpenTab }: { onOpenTab: (tab: string) => void }) => (
    <button type="button" onClick={() => onOpenTab('review')}>
      Open Review from Overview
    </button>
  ),
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => agentStore,
  useAgentStore: (selector: (s: typeof agentStore) => unknown) => selector(agentStore),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => agentStore.rawAgencyConfig,
    isWorkspaceAgentById: () => () => false,
  },
  agentSelectors: {
    isCurrentAgentHeterogeneous: () => agentStore.isHeterogeneous,
  },
  chatConfigByIdSelectors: {
    isChatModeById: () => () => false,
  },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: typeof globalStore) => unknown) => selector(globalStore),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    workingSidebarWidth: (s: typeof globalStore) => s.status.workingSidebarWidth || 360,
  },
}));
vi.mock('@/store/electron', () => ({ useElectronStore: () => undefined }));
vi.mock('@/store/chat', () => ({ useChatStore: () => undefined }));

vi.mock('@/business/client/features/WorkingSidebarTabs', () => ({
  useBusinessWorkingSidebarTabs: () => businessTabs.current,
}));

vi.mock('@/features/ChatInput/ControlBar/useRepoType', async () => {
  const { useState } = await import('react');

  return {
    useRepoType: () => {
      const [repoType, setRepoType] = useState(reviewState.repoType);
      reviewState.setRepoType = setRepoType;
      return repoType;
    },
  };
});
vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => reviewState.workingDirectory,
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: effectiveConfig.agencyConfig,
    workspaceScoped: effectiveConfig.workspaceScoped,
  }),
}));
vi.mock('@/hooks/useLocalStorageState', async () => {
  const { useState } = await import('react');

  return {
    useLocalStorageState: (key: string) =>
      useState(
        key === 'lobechat-review-tree'
          ? reviewState.showTree
          : key === 'lobechat-working-sidebar-pinned-tabs-v1'
            ? localStorageState.pinnedTabsByAgent
            : localStorageState.openTabsByContext,
      ),
  };
});
vi.mock('@/helpers/agentWorkingDirectory', () => ({ resolveTargetDeviceId: () => undefined }));
vi.mock('@/helpers/executionTarget', () => ({
  resolveExecutionTarget: (
    agencyConfig: { executionTarget?: 'device' | 'local' } | undefined,
    options: { workspaceScoped?: boolean },
  ) => (options.workspaceScoped ? 'device' : (agencyConfig?.executionTarget ?? 'local')),
}));
vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button aria-label={title} type="button" onClick={onClick} />
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Skeleton: () => <div data-testid="params-loading" />,
}));

vi.mock('@lobehub/ui/base-ui', async () => {
  const { useState } = await import('react');

  return {
    ContextMenuTrigger: ({ children, items }: { children: ReactNode; items: any[] }) => {
      const [open, setOpen] = useState(false);
      const menuItems = items.filter((item) => item && item.type !== 'divider');

      return (
        <span
          onContextMenu={(event: MouseEvent) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          {children}
          {open &&
            menuItems.map((item) => (
              <button disabled={item.disabled} key={item.key} type="button" onClick={item.onClick}>
                {item.label}
              </button>
            ))}
        </span>
      );
    },
    DropdownMenu: ({
      children,
      items,
      onOpenChangeComplete,
    }: {
      children: ReactNode;
      items: any[];
      onOpenChangeComplete?: (open: boolean) => void;
    }) => {
      const [open, setOpen] = useState(false);
      const menuItems = items.flatMap((item) => item.children ?? []);
      dropdownMenuState.onOpenChangeComplete = onOpenChangeComplete;

      return (
        <div>
          <span onClick={() => setOpen((value) => !value)}>{children}</span>
          {open &&
            menuItems.map((item) => (
              <button key={item.key} type="button" onClick={item.onClick}>
                {item.label}
              </button>
            ))}
        </div>
      );
    },
  };
});

vi.mock('antd-style', () => ({
  createStaticStyles: () => () => ({}),
}));

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  businessTabs.current = [];
  paramsSectionState.suspend = false;
  localStorageState.openTabsByContext = { 'draft:default:none': ['params'] };
  localStorageState.pinnedTabsByAgent = {};
  agentStore.activeAgentId = undefined;
  agentStore.isHeterogeneous = false;
  agentStore.rawAgencyConfig = undefined;
  effectiveConfig.agencyConfig = undefined;
  effectiveConfig.workspaceScoped = false;
  filesProps.current = undefined;
  reviewState.repoType = undefined;
  reviewState.setRepoType = undefined;
  reviewState.showTree = false;
  reviewState.workingDirectory = undefined;
  dropdownMenuState.onOpenChangeComplete = undefined;
  globalStore.status.workingSidebarWidth = 360;
  globalStore.status.showRightPanel = true;
  globalStore.status.workingSidebarTab = 'params';
  globalStore.status.workingSidebarTabRequest = undefined;
  globalStore.updateSystemStatus.mockReset();
  globalStore.toggleRightPanel.mockReset();
  globalStore.toggleTerminalPanel.mockReset();
  globalStore.setWorkingSidebarTab.mockReset();
});

afterEach(() => {
  rightPanel.current = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('AgentWorkingSidebar — controlled panel width', () => {
  it('seeds the RightPanel with the default width', () => {
    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.width).toBe(360);
  });

  it('allows the panel to grow across wide displays without consuming the full viewport', () => {
    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.maxWidth).toBe(1200);
  });

  it('restores a previously persisted width from systemStatus', () => {
    globalStore.status.workingSidebarWidth = 520;

    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.width).toBe(520);
  });

  it('clamps two-pane Review width without overwriting the persisted preference', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.showTree = true;
    reviewState.workingDirectory = 'C:\\repo';
    globalStore.status.workingSidebarTab = 'review';
    localStorageState.openTabsByContext = { 'draft:agent:C:\\repo': ['review'] };

    const { unmount } = render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.defaultWidth).toBe(560);
    expect(rightPanel.current?.width).toBe(560);
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();

    unmount();
    globalStore.status.workingSidebarTab = 'params';
    render(<AgentWorkingSidebar />);
    expect(rightPanel.current?.width).toBe(360);
  });

  // Regression: DraggablePanel reports the dragged width as a `"480px"` string on
  // drag-stop. A `typeof width === 'number'` guard silently dropped it, so the
  // controlled width never updated and the panel snapped back — appearing
  // impossible to resize. The handler must parse the px string.
  it('applies a "480px" string width from a drag so the panel actually resizes', () => {
    const { unmount } = render(<AgentWorkingSidebar />);

    act(() => {
      rightPanel.current?.onSizeChange?.({ width: '480px' });
    });

    expect(globalStore.updateSystemStatus).toHaveBeenCalledWith({ workingSidebarWidth: 480 });

    globalStore.status.workingSidebarWidth = 480;
    unmount();
    render(<AgentWorkingSidebar />);
    expect(rightPanel.current?.width).toBe(480);
  });

  it('applies a numeric drag width unchanged', () => {
    const { unmount } = render(<AgentWorkingSidebar />);

    act(() => {
      rightPanel.current?.onSizeChange?.({ width: 500 });
    });

    expect(globalStore.updateSystemStatus).toHaveBeenCalledWith({ workingSidebarWidth: 500 });

    globalStore.status.workingSidebarWidth = 500;
    unmount();
    render(<AgentWorkingSidebar />);
    expect(rightPanel.current?.width).toBe(500);
  });

  it('ignores a size update with no width', () => {
    render(<AgentWorkingSidebar />);

    act(() => {
      rightPanel.current?.onSizeChange?.({ height: '100%' });
    });

    expect(rightPanel.current?.width).toBe(360);
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();
  });

  it('indexes a workspace-local project on this desktop instead of the shared bound device', () => {
    agentStore.activeAgentId = 'agent';
    agentStore.isHeterogeneous = true;
    // The shared row can still point at a workspace device. This member's
    // private override selects their own desktop and must win for both the cwd
    // and the file transport.
    agentStore.rawAgencyConfig = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'device',
    };
    effectiveConfig.agencyConfig = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
    };
    reviewState.workingDirectory = '/Users/me/project';
    globalStore.status.workingSidebarTab = 'files';

    render(<AgentWorkingSidebar />);

    expect(filesProps.current).toEqual({
      deviceId: undefined,
      workingDirectory: '/Users/me/project',
    });
  });

  it('keeps a shared local fallback on its bound workspace device without a member override', () => {
    agentStore.activeAgentId = 'agent';
    agentStore.isHeterogeneous = true;
    effectiveConfig.agencyConfig = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'local',
    };
    effectiveConfig.workspaceScoped = true;
    reviewState.workingDirectory = '/workspace/project';
    globalStore.status.workingSidebarTab = 'files';

    render(<AgentWorkingSidebar />);

    expect(filesProps.current).toEqual({
      deviceId: 'workspace-device',
      workingDirectory: '/workspace/project',
    });
  });
});

describe('AgentWorkingSidebar — tab strip', () => {
  // Regression: at the 300px minimum panel width, labels such as “Deployments”
  // were allowed to shrink and wrap inside words. Tabs now stay on one line in a
  // horizontal strip, so a persisted tab near the end must be brought into view.
  it('scrolls the whole active tab, including its close button, into view', () => {
    globalStore.status.workingSidebarTab = 'params';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({
            left: 120 - (this.parentElement?.scrollLeft ?? 0),
            right: 222 - (this.parentElement?.scrollLeft ?? 0),
          } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });

    expect(paramsTab).toHaveAttribute('aria-pressed', 'true');
    expect(paramsTab.parentElement?.parentElement?.parentElement?.scrollLeft).toBe(22);
  });

  it('restores the complete active tab after the open menu closes and focus moves', async () => {
    globalStore.status.workingSidebarTab = 'params';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({
            left: 120 - (this.parentElement?.scrollLeft ?? 0),
            right: 222 - (this.parentElement?.scrollLeft ?? 0),
          } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });
    const tabs = paramsTab.parentElement?.parentElement?.parentElement;

    if (tabs) tabs.scrollLeft = 0;
    act(() => dropdownMenuState.onOpenChangeComplete?.(false));

    await waitFor(() => expect(tabs?.scrollLeft).toBe(22));
  });

  it('exposes and reveals a persisted active Works tab', () => {
    globalStore.status.workingSidebarTab = 'works';
    localStorageState.openTabsByContext = { 'draft:default:none': ['works'] };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({ left: 120, right: 222 } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const worksTab = screen.getByRole('button', { name: 'workingPanel.works.title' });

    expect(worksTab).toHaveAttribute('aria-pressed', 'true');
    expect(worksTab.parentElement?.parentElement?.parentElement?.scrollLeft).toBe(22);
  });

  it('reveals the active tab again when an async tab becomes available', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.workingDirectory = '/repo';
    globalStore.status.workingSidebarTab = 'params';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['params', 'review'] };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({ left: 120, right: 222 } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });
    const tabs = paramsTab.parentElement?.parentElement?.parentElement;
    expect(tabs?.scrollLeft).toBe(22);

    act(() => reviewState.setRepoType?.('git'));

    expect(screen.getByRole('button', { name: 'workingPanel.review.title' })).toBeInTheDocument();
    expect(tabs?.scrollLeft).toBe(44);
  });

  it('renders business tabs after the built-in ones', () => {
    businessTabs.current = [
      { key: 'deployments', label: 'workingPanel.deployments.tab', pane: <div /> },
    ];
    localStorageState.openTabsByContext = {
      'draft:default:none': ['params', 'deployments'],
    };

    render(<AgentWorkingSidebar />);
    const labels = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'))
      .map((button) => button.textContent)
      .filter(Boolean);

    expect(labels).toEqual([
      'workingPanel.overview.title',
      'settingModel.params.panel.tab',
      'workingPanel.deployments.tab',
    ]);
  });

  it('keeps Overview fixed and hides unopened workspace tabs', () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = undefined;

    render(<AgentWorkingSidebar />);

    expect(screen.getByRole('button', { name: 'workingPanel.overview.title' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.queryByRole('button', { name: 'workingPanel.resources' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.works.title' }),
    ).not.toBeInTheDocument();
  });

  it('places Overview in the same horizontal scroll container as on-demand tabs', () => {
    render(<AgentWorkingSidebar />);
    const overviewTab = screen.getByRole('button', { name: 'workingPanel.overview.title' });
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });

    expect(overviewTab.parentElement?.parentElement?.parentElement).toBe(
      paramsTab.parentElement?.parentElement?.parentElement,
    );
  });

  it('keeps the working panel chrome visible while the Params pane is suspended', () => {
    paramsSectionState.suspend = true;

    render(<AgentWorkingSidebar />);

    expect(screen.getByRole('button', { name: 'workingPanel.overview.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'workingPanel.openMenu.title' })).toBeInTheDocument();
    expect(screen.getByTestId('params-loading')).toBeInTheDocument();
  });

  it('restores pinned tabs only for the agent that owns them', () => {
    agentStore.activeAgentId = 'agent-a';
    localStorageState.openTabsByContext = {};
    localStorageState.pinnedTabsByAgent = { 'agent-a': ['works'] };
    globalStore.status.workingSidebarTab = 'overview';

    const { unmount } = render(<AgentWorkingSidebar />);
    const pinnedWorksTab = screen.getByRole('button', { name: 'workingPanel.works.title' });

    expect(pinnedWorksTab.parentElement).toHaveAttribute('data-pinned', 'true');
    expect(
      screen.queryByRole('button', { name: 'workingPanel.tabs.close' }),
    ).not.toBeInTheDocument();

    unmount();
    agentStore.activeAgentId = 'agent-b';
    render(<AgentWorkingSidebar />);

    expect(
      screen.queryByRole('button', { name: 'workingPanel.works.title' }),
    ).not.toBeInTheDocument();
  });

  it('pins and unpins a tab from its context menu', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = { 'draft:agent:none': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });

    fireEvent.contextMenu(paramsTab);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.pin' }));

    expect(paramsTab.parentElement).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByRole('button', { name: 'workingPanel.tabs.close' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.unpin' }));

    expect(paramsTab.parentElement).not.toHaveAttribute('data-pinned');
    expect(
      screen
        .getAllByRole('button', { name: 'workingPanel.tabs.close' })
        .some((button) => !button.hasAttribute('disabled')),
    ).toBe(true);
  });

  it('closes the current tab from its context menu', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = { 'draft:agent:none': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));
    fireEvent.click(screen.getByText('workingPanel.tabs.close'));

    expect(
      screen.queryByRole('button', { name: 'settingModel.params.panel.tab' }),
    ).not.toBeInTheDocument();
    expect(globalStore.setWorkingSidebarTab).toHaveBeenCalledWith('overview');
  });

  it('preserves agent-pinned tabs when closing other tabs', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = {
      'draft:agent:none': ['resources', 'works', 'params'],
    };
    localStorageState.pinnedTabsByAgent = { agent: ['works'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.closeOthers' }));

    expect(screen.getByRole('button', { name: 'workingPanel.works.title' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.resources' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'settingModel.params.panel.tab' }),
    ).toBeInTheDocument();
  });

  it('opens an available workspace tab once from the grouped menu', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.review.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));

    expect(screen.getAllByRole('button', { name: 'workingPanel.review.title' })).toHaveLength(1);
    expect(globalStore.setWorkingSidebarTab).toHaveBeenCalledWith('review');
  });

  it('moves focus to a tab opened from the grouped menu', async () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';
    globalStore.setWorkingSidebarTab.mockImplementation((tab: string) => {
      globalStore.status.workingSidebarTab = tab;
    });

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));

    await waitFor(
      () => {
        const paramsTab = screen
          .getAllByRole('button', { name: 'settingModel.params.panel.tab' })
          .find((button) => button.hasAttribute('aria-pressed'));
        expect(paramsTab).toHaveFocus();
      },
      { timeout: 1000 },
    );
  });

  it('returns to Overview when the active on-demand tab closes', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['review'] };
    globalStore.status.workingSidebarTab = 'review';

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.close' }));

    expect(globalStore.setWorkingSidebarTab).toHaveBeenCalledWith('overview');
  });

  it('reopens a closed tab when the same external target is requested again', async () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = undefined;
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);
    expect(
      screen.queryByRole('button', { name: 'workingPanel.review.title' }),
    ).not.toBeInTheDocument();

    globalStore.status.workingSidebarTabRequest = { nonce: 1, tab: 'review' };
    act(() => reviewState.setRepoType?.('git'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'workingPanel.review.title' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.close' }));
    expect(
      screen.queryByRole('button', { name: 'workingPanel.review.title' }),
    ).not.toBeInTheDocument();

    globalStore.status.workingSidebarTabRequest = { nonce: 2, tab: 'review' };
    act(() => reviewState.setRepoType?.('github'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'workingPanel.review.title' })).toBeInTheDocument();
    });
  });
});
