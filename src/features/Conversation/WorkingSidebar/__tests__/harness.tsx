import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { useDeviceStore } from '@/store/device';

import type { ComposerTarget } from '../../types';

// Shared mock harness for the WorkingSidebar suites. Import this module before
// `../index` so every module mock is registered before the component loads.

// ─── captured RightPanel props ────────────────────────────────────────────────
// The real RightPanel is a controlled DraggablePanel; here we stub it so the test
// can read back the `width` it receives and drive its `onSizeChange` directly.

export interface CapturedRightPanelProps {
  children?: ReactNode;
  defaultWidth?: number | string;
  expand?: boolean;
  maxWidth?: number | string;
  onSizeChange?: (size?: { height?: number | string; width?: number | string }) => void;
  style?: CSSProperties;
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
const linkedPR = vi.hoisted(() => ({
  number: undefined as number | undefined,
  branch: 'feature' as string | undefined,
  status: undefined as string | undefined,
}));

vi.mock('@/store/device', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFetchGitBranch: () => ({ data: linkedPR.branch ? { branch: linkedPR.branch } : undefined }),
  useFetchGitLinkedPR: () => ({
    data: {
      pullRequestStatus: linkedPR.status,
      pullRequest: linkedPR.number
        ? { number: linkedPR.number, state: 'open', url: 'https://github.com/test/repo/pull/1' }
        : undefined,
    },
  }),
}));

vi.mock('../PullRequest', async () => {
  const { useState } = await import('react');
  return {
    default: function PullRequestDraft() {
      const [draft, setDraft] = useState('');
      return (
        <input
          aria-label="PR draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    },
  };
});

const filesProps = vi.hoisted(() => ({
  current: undefined as { deviceId?: string; workingDirectory: string } | undefined,
}));
const filesPrefetchProps = vi.hoisted(() => ({
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
  // read by the real topicSelectors.currentTopicMetadata (sourcePath resolution)
  topicDataMap: {} as Record<string, unknown>,
  topicDetailMap: {} as Record<string, unknown>,
}));

const globalStore = vi.hoisted(() => ({
  openWorkingSidebar: vi.fn(),
  updateSystemStatus: vi.fn(),
  toggleRightPanel: vi.fn(),
  toggleTerminalPanel: vi.fn(),
  setWorkingSidebarTab: vi.fn(),
  status: {
    portalWidth: 400 as number | undefined,
    portalWidths: undefined as Record<string, number> | undefined,
    showRightPanel: true,
    showWorkingOverview: true as boolean | undefined,
    workingSidebarTab: 'params' as string | undefined,
    workingSidebarTabRequest: undefined as { nonce: number; tab: string } | undefined,
    workingSidebarWidth: 360 as number | undefined,
  },
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('motion/react-m', () => ({
  div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@/features/RightPanel', () => ({
  default: (props: CapturedRightPanelProps) => {
    rightPanel.current = props;
    return (
      <div data-testid="right-panel" style={props.style}>
        {props.children}
      </div>
    );
  },
}));

// ─── stub every downstream dependency so the sidebar renders deterministically ──

vi.mock('../Files', () => ({
  default: (props: { deviceId?: string; workingDirectory: string }) => {
    filesProps.current = props;
    return <div data-testid="files" />;
  },
}));
vi.mock('../Files/FilesPrefetch', () => ({
  default: (props: { deviceId?: string; workingDirectory: string }) => {
    filesPrefetchProps.current = props;
    return <div data-testid="files-prefetch" />;
  },
}));
vi.mock('../Review', () => ({
  default: (props: { composerTarget: ComposerTarget }) => {
    renderedReview.current = props;
    return <div data-testid="review" />;
  },
}));
vi.mock('../ProgressSection', () => ({ default: () => <div /> }));
vi.mock('../ResourcesSection', () => ({ default: () => <div /> }));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => <div data-testid="sidebar-skeleton" />,
}));
vi.mock('../ParamsSection', () => ({
  default: () => {
    if (paramsSectionState.suspend) throw paramsSectionState.pending;
    return <div data-testid="params-section" />;
  },
}));
vi.mock('../WorksSection', () => ({ default: () => <div /> }));
vi.mock('../Search', () => ({
  TopicSearchPane: ({ topicId }: { topicId: string }) => (
    <div data-testid="topic-search">{topicId}</div>
  ),
}));
vi.mock('@/hooks/useHotkeys', () => ({ useFindInTopicHotkey: () => undefined }));
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
    pullRequest,
    workingDirectory,
  }: {
    environmentAvailable: boolean;
    onOpenTab: (tab: string) => void;
    pullRequest?: { number: number };
    workingDirectory?: string;
  }) => (
    <>
      <button type="button" onClick={() => onOpenTab('review')}>
        Open Review from Overview
      </button>
      {pullRequest && (
        <button type="button" onClick={() => onOpenTab('pr')}>
          Open Pull Request from Overview
        </button>
      )}
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
    portalWidth: (s: typeof globalStore) => s.status.portalWidth || 400,
    portalWidths: (s: typeof globalStore) => s.status.portalWidths,
    showWorkingOverview: (s: typeof globalStore) =>
      s.status.showWorkingOverview ?? !s.status.showRightPanel,
    workingSidebarWidth: (s: typeof globalStore) => s.status.workingSidebarWidth || 360,
  },
}));
vi.mock('@/store/electron', () => ({ useElectronStore: () => undefined }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof chatStore) => unknown) => selector(chatStore),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => workspace.id,
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
vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
        <button aria-label={title} type="button" onClick={onClick} />
      ),
      Skeleton: () => <div data-testid="params-loading" />,
    }),
    async (importOriginal) => {
      const { useState } = await import('react');
      const actual = (await importOriginal()) as Record<string, unknown>;

      return {
        ...actual,
        ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
          <button aria-label={title} type="button" onClick={onClick} />
        ),
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
                  <button
                    disabled={item.disabled}
                    key={item.key}
                    type="button"
                    onClick={item.onClick}
                  >
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
        Skeleton: {
          Text: () => <div data-testid="params-loading" />,
        },
      };
    },
    async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>;
      return {
        ...actual,
        createStaticStyles: () => () => ({}),
      };
    },
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});

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
  linkedPR.number = undefined;
  linkedPR.branch = 'feature';
  linkedPR.status = undefined;
  chatStore.topicDataMap = {};
  chatStore.topicDetailMap = {};
  filesProps.current = undefined;
  filesPrefetchProps.current = undefined;
  localStorage.clear();
  useDeviceStore.setState({ deviceListMap: {} });
  renderedReview.current = undefined;
  reviewState.repoType = undefined;
  reviewState.setRepoType = undefined;
  reviewState.showTree = false;
  reviewState.workingDirectory = undefined;
  dropdownMenuState.onOpenChangeComplete = undefined;
  dropdownMenuState.items = [];
  globalStore.status.workingSidebarWidth = 360;
  globalStore.status.showRightPanel = true;
  globalStore.status.showWorkingOverview = true;
  globalStore.status.workingSidebarTab = 'params';
  globalStore.status.workingSidebarTabRequest = undefined;
  globalStore.updateSystemStatus.mockReset();
  globalStore.openWorkingSidebar.mockReset();
  globalStore.toggleRightPanel.mockReset();
  globalStore.toggleTerminalPanel.mockReset();
  globalStore.setWorkingSidebarTab.mockReset();
});

afterEach(() => {
  rightPanel.current = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

export {
  agentStore,
  browserPanes,
  businessTabs,
  chatStore,
  dropdownMenuState,
  effectiveConfig,
  filesPrefetchProps,
  filesProps,
  globalStore,
  linkedPR,
  localStorageState,
  paramsSectionState,
  platform,
  renderedReview,
  reviewState,
  rightPanel,
  workspace,
};
