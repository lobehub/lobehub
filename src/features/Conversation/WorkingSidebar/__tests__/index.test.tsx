import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import type { ComposerTarget } from '../../types';
import AgentWorkingSidebar from '../index';

// ─── captured RightPanel props ────────────────────────────────────────────────
// The real RightPanel is a controlled DraggablePanel; here we stub it so the test
// can read back the `width` it receives and drive its `onSizeChange` directly.

interface CapturedRightPanelProps {
  children?: ReactNode;
  defaultWidth?: number | string;
  expand?: boolean;
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

const platform = vi.hoisted(() => ({ isDesktop: true }));

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

const browserPanes = vi.hoisted(() => ({
  current: [] as {
    composerTarget: ComposerTarget;
    onMetadataChange?: (metadata: { faviconUrl?: string; title: string; url: string }) => void;
    sessionId: string;
  }[],
}));

const renderedReview = vi.hoisted(() => ({
  current: undefined as { composerTarget: ComposerTarget } | undefined,
}));

const localStorageState = vi.hoisted(() => ({
  openTabsByContext: {} as Record<string, string[]>,
  pinnedTabsByAgent: {} as Record<string, string[]>,
}));

const dropdownMenuState = vi.hoisted(() => ({
  items: [] as any[],
  onOpenChangeComplete: undefined as ((open: boolean) => void) | undefined,
}));

const workspace = vi.hoisted(() => ({ id: undefined as string | undefined }));

const chatStore = vi.hoisted(() => ({
  activeAgentId: undefined as string | undefined,
  activeGroupId: undefined as string | undefined,
  activeThreadId: undefined as string | undefined,
  activeTopicId: undefined as string | undefined,
  openTopicComments: vi.fn(),
  portalStack: [] as Array<{ startMessageId?: string; threadId?: string; type: string }>,
  showPortal: false,
  threadMaps: {} as Record<string, any[]>,
}));

const globalStore = vi.hoisted(() => ({
  updateSystemStatus: vi.fn(),
  toggleRightPanel: vi.fn(),
  toggleTerminalPanel: vi.fn(),
  setWorkingSidebarTab: vi.fn(),
  status: {
    portalWidth: 400 as number | undefined,
    portalWidths: undefined as Record<string, number> | undefined,
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
vi.mock('../Review', () => ({
  default: (props: { composerTarget: ComposerTarget }) => {
    renderedReview.current = props;
    return <div />;
  },
}));
vi.mock('../ProgressSection', () => ({ default: () => <div /> }));
vi.mock('../ResourcesSection', () => ({ default: () => <div /> }));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({ default: () => <div /> }));
vi.mock('../ParamsSection', () => ({
  default: () => {
    if (paramsSectionState.suspend) throw paramsSectionState.pending;
    return <div data-testid="params-section" />;
  },
}));
vi.mock('../WorksSection', () => ({ default: () => <div /> }));
vi.mock('../Browser', () => ({
  default: (props: (typeof browserPanes.current)[number]) => {
    browserPanes.current.push(props);
    return <div data-testid={`browser-pane-${props.sessionId}`} />;
  },
}));
vi.mock('../Overview', () => ({
  default: ({
    environmentAvailable,
    onOpenTab,
    workingDirectory,
  }: {
    environmentAvailable: boolean;
    onOpenTab: (tab: string) => void;
    workingDirectory?: string;
  }) => (
    <>
      <button type="button" onClick={() => onOpenTab('review')}>
        Open Review from Overview
      </button>
      {environmentAvailable && <span>Workspace environment</span>}
      {workingDirectory && <span>{workingDirectory}</span>}
    </>
  ),
}));
vi.mock('@/features/Portal/TopicComments/Sidebar', () => ({
  default: () => <div data-testid="comments" />,
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => agentStore,
  useAgentStore: (selector: (s: typeof agentStore) => unknown) => selector(agentStore),
}));
vi.mock('@/store/agent/projection', () => ({
  agentProjectionSelectors: {
    heterogeneous: (agent: { heterogeneous: boolean }) => agent.heterogeneous,
    toolMode: (agent: { toolMode: string }) => agent.toolMode,
  },
  useAgentValue: (_agentId: string | undefined, selector: (agent: object) => unknown) =>
    selector({ toolMode: 'agent' }),
  useCurrentAgentValue: (selector: (agent: object) => unknown) =>
    selector({ heterogeneous: agentStore.isHeterogeneous }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: typeof globalStore) => unknown) => selector(globalStore),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    portalWidth: (s: typeof globalStore) => s.status.portalWidth || 400,
    portalWidths: (s: typeof globalStore) => s.status.portalWidths,
    workingSidebarWidth: (s: typeof globalStore) => s.status.workingSidebarWidth || 360,
  },
}));
vi.mock('@/store/electron', () => ({ useElectronStore: () => undefined }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof chatStore) => unknown) => selector(chatStore),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspace.id,
}));

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
    options: { clientExecutionAvailable: boolean; workspaceScoped?: boolean },
  ) => {
    if (options.workspaceScoped) return 'device';
    const target = agencyConfig?.executionTarget;
    if (!options.clientExecutionAvailable && target === 'local') return 'sandbox';
    return target ?? (options.clientExecutionAvailable ? 'local' : 'none');
  },
}));
vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => false }));
vi.mock('@/const/version', () => ({
  get isDesktop() {
    return platform.isDesktop;
  },
}));
vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableInAppBrowser: () => true },
}));

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
      items: any[] | (() => any[]);
      onOpenChangeComplete?: (open: boolean) => void;
    }) => {
      const [open, setOpen] = useState(false);
      const resolvedItems = typeof items === 'function' ? items() : items;
      const menuItems = resolvedItems.flatMap((item) => item.children ?? []);
      dropdownMenuState.items = resolvedItems;
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

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStaticStyles: () => () => ({}),
}));

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  businessTabs.current = [];
  browserPanes.current = [];
  paramsSectionState.suspend = false;
  localStorageState.openTabsByContext = { 'draft:default:none': ['params'] };
  localStorageState.pinnedTabsByAgent = {};
  workspace.id = undefined;
  chatStore.activeAgentId = undefined;
  chatStore.activeGroupId = undefined;
  chatStore.activeThreadId = undefined;
  chatStore.activeTopicId = undefined;
  chatStore.portalStack = [];
  chatStore.showPortal = false;
  chatStore.threadMaps = {};
  chatStore.openTopicComments.mockReset();
  agentStore.activeAgentId = undefined;
  agentStore.isHeterogeneous = false;
  agentStore.rawAgencyConfig = undefined;
  effectiveConfig.agencyConfig = undefined;
  effectiveConfig.workspaceScoped = false;
  platform.isDesktop = true;
  filesProps.current = undefined;
  renderedReview.current = undefined;
  reviewState.repoType = undefined;
  reviewState.setRepoType = undefined;
  reviewState.showTree = false;
  reviewState.workingDirectory = undefined;
  dropdownMenuState.onOpenChangeComplete = undefined;
  dropdownMenuState.items = [];
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

  // Regression: dragging the panel wide persisted a width that immediately
  // failed the fits check, so releasing the drag unmounted the whole sidebar —
  // and, with the too-wide value stored, it never came back at that window
  // size. A stored width beyond the row's budget must render clamped (and cap
  // further dragging) instead of hiding the panel.
  it('clamps a stored width that outgrew the row instead of hiding the panel', () => {
    globalStore.status.workingSidebarWidth = 1250;

    render(<AgentWorkingSidebar availableWidth={1540} />);

    expect(rightPanel.current?.expand).toBe(true);
    // 1540 - CONVERSATION_KEEP_WIDTH (420)
    expect(rightPanel.current?.width).toBe(1120);
    expect(rightPanel.current?.maxWidth).toBe(1120);
    // the clamp is render-only: the user's preference survives for wider rows
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();
  });

  it('still yields the whole panel when even the minimum width leaves no room', () => {
    render(<AgentWorkingSidebar availableWidth={600} />);

    // 600 - 420 = 180 < the 300 minimum — nothing to clamp to, so it hides
    expect(rightPanel.current?.expand).toBe(false);
  });

  it('keeps a fitting stored width untouched on a measured row', () => {
    render(<AgentWorkingSidebar availableWidth={1540} />);

    expect(rightPanel.current?.expand).toBe(true);
    expect(rightPanel.current?.width).toBe(360);
    expect(rightPanel.current?.maxWidth).toBe(1120);
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

  it('does not expose a persisted local workspace when the web client has no local runtime', () => {
    platform.isDesktop = false;
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/Users/me/project';
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);

    expect(screen.queryByText('Workspace environment')).not.toBeInTheDocument();
    expect(screen.queryByText('/Users/me/project')).not.toBeInTheDocument();
    expect(filesProps.current).toBeUndefined();
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
      screen.queryByRole('button', { name: 'workingPanel.resources.filter.skills' }),
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
      'draft:agent:none': ['skills', 'works', 'params'],
    };
    localStorageState.pinnedTabsByAgent = { agent: ['works'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.closeOthers' }));

    expect(screen.getByRole('button', { name: 'workingPanel.works.title' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.resources.filter.skills' }),
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

  it('creates an independent browser tab every time Browser is chosen', async () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    const { container } = render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.browser.title' }));
    await waitFor(() => {
      expect(container.querySelectorAll('button[data-tab-key^="browser"]')).toHaveLength(1);
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'workingPanel.browser.title' })
        .find((button) => !button.hasAttribute('aria-pressed'))!,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('button[data-tab-key^="browser"]')).toHaveLength(2);
    });
    const sessionIds = [...new Set(browserPanes.current.map((pane) => pane.sessionId))];
    expect(sessionIds).toHaveLength(2);
    expect(sessionIds).toContain('draft-agent:default');
    expect(sessionIds.find((id) => id !== 'draft-agent:default')).toMatch(
      /^draft-agent:default:tab:/,
    );
  });

  it('routes Browser and Review context selections to the open portal thread', async () => {
    const agentId = 'agent';
    const topicId = 'topic';
    const threadId = 'thread';
    const expectedKey = messageMapKey({ agentId, threadId, topicId });
    agentStore.activeAgentId = agentId;
    chatStore.activeAgentId = agentId;
    chatStore.activeTopicId = topicId;
    chatStore.portalStack = [{ threadId, type: PortalViewType.Thread }];
    chatStore.showPortal = true;
    chatStore.threadMaps = { [topicId]: [{ agentId, id: threadId, topicId }] };
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { [`topic:${topicId}`]: ['browser'] };
    globalStore.status.workingSidebarTab = 'browser';

    render(<AgentWorkingSidebar />);

    await waitFor(() => expect(browserPanes.current.at(-1)).toBeDefined());
    expect(browserPanes.current.at(-1)?.composerTarget).toEqual({
      contextKey: expectedKey,
      writable: true,
    });
    expect(renderedReview.current?.composerTarget).toEqual({
      contextKey: expectedKey,
      writable: true,
    });
  });

  it('marks Browser and Review context actions read-only for a subagent thread', async () => {
    const topicId = 'topic';
    const threadId = 'subagent-thread';
    chatStore.activeAgentId = 'agent';
    chatStore.activeTopicId = topicId;
    chatStore.portalStack = [{ threadId, type: PortalViewType.Thread }];
    chatStore.showPortal = true;
    chatStore.threadMaps = {
      [topicId]: [{ id: threadId, metadata: { sourceToolCallId: 'tool-call' }, topicId }],
    };
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { [`topic:${topicId}`]: ['browser'] };
    globalStore.status.workingSidebarTab = 'browser';

    render(<AgentWorkingSidebar />);

    await waitFor(() => expect(browserPanes.current.at(-1)).toBeDefined());
    expect(browserPanes.current.at(-1)?.composerTarget).toEqual({
      reason: 'read-only',
      writable: false,
    });
    expect(renderedReview.current?.composerTarget).toEqual({
      reason: 'read-only',
      writable: false,
    });
  });

  it('uses browser page metadata for the tab title and favicon', async () => {
    localStorageState.openTabsByContext = { 'draft:default:none': ['browser'] };
    globalStore.status.workingSidebarTab = 'browser';

    const { container } = render(<AgentWorkingSidebar />);
    await waitFor(() => expect(browserPanes.current.at(-1)).toBeDefined());
    act(() => {
      browserPanes.current.at(-1)?.onMetadataChange?.({
        faviconUrl: 'https://example.com/favicon.ico',
        title: 'Example Domain',
        url: 'https://example.com',
      });
    });

    expect(screen.getByRole('button', { name: 'Example Domain' })).toBeInTheDocument();
    expect(
      container.querySelector('img[src="https://example.com/favicon.ico"]'),
    ).toBeInTheDocument();
  });

  it('preserves natural casing for grouped menu labels', () => {
    render(<AgentWorkingSidebar />);

    const groups = dropdownMenuState.items.filter((item) => item.type === 'group');

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.label.props.style).toEqual({ textTransform: 'none' });
    }
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

  it('collapses the panel when the last remaining tab is closed', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['review'] };
    globalStore.status.workingSidebarTab = 'review';

    render(<AgentWorkingSidebar />);
    expect(
      screen.queryByRole('button', { name: 'workingPanel.tabs.closePanel' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.close' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.closePanel' }));

    expect(globalStore.toggleRightPanel).toHaveBeenCalledWith(false);
  });

  it('keeps the last tab closable from its context menu', () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'workingPanel.overview.title' }));
    fireEvent.click(screen.getByText('workingPanel.tabs.closePanel'));

    expect(globalStore.toggleRightPanel).toHaveBeenCalledWith(false);
  });

  it('leaves a pinned tab standing instead of collapsing the panel', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = {};
    localStorageState.pinnedTabsByAgent = { agent: ['works'] };
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);

    expect(
      screen.queryByRole('button', { name: 'workingPanel.tabs.closePanel' }),
    ).not.toBeInTheDocument();
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

  it('offers Comments for a workspace topic and opens it in this panel', () => {
    workspace.id = 'workspace-1';
    chatStore.activeTopicId = 'topic-1';

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    const commentsItem = screen.getByRole('button', { name: 'topicComment.title' });

    fireEvent.click(commentsItem);

    expect(chatStore.openTopicComments).toHaveBeenCalledWith('topic-1');
  });

  it('hides Comments when there is no workspace topic', () => {
    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));

    expect(screen.queryByRole('button', { name: 'topicComment.title' })).not.toBeInTheDocument();
  });
});
