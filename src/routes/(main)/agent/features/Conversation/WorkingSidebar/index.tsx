import { ActionIcon, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { type ContextMenuItem, type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  BoxesIcon,
  CheckIcon,
  ClipboardListIcon,
  FilesIcon,
  FolderOpenIcon,
  Globe2Icon,
  LayoutDashboardIcon,
  PanelRightCloseIcon,
  PanelsTopLeftIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Settings2Icon,
  SquareTerminalIcon,
  XIcon,
} from 'lucide-react';
import {
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessWorkingSidebarTabs } from '@/business/client/features/WorkingSidebarTabs';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { useRepoType } from '@/features/ChatInput/ControlBar/useRepoType';
import RightPanel from '@/features/RightPanel';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import Files from './Files';
import Overview from './Overview';
import ResourcesSection from './ResourcesSection';
import Review from './Review';
import WorkspaceTab from './WorkspaceTab';
import WorksSection from './WorksSection';

const ParamsSection = lazy(() => import('./ParamsSection'));
const BrowserPane = lazy(() => import('./Browser'));

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  close: css`
    flex-shrink: 0;
  `,
  header: css`
    flex-shrink: 0;
    min-width: 0;
  `,
  pane: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  paneHidden: css`
    display: none;
  `,
  paramsLoading: css`
    width: 100%;
    padding: 16px;
  `,
  tabs: css`
    overflow-anchor: none;
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    flex: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const REVIEW_TREE_STORAGE_KEY = 'lobechat-review-tree';
const OPEN_TABS_STORAGE_KEY = 'lobechat-working-sidebar-open-tabs-v1';
const PINNED_TABS_STORAGE_KEY = 'lobechat-working-sidebar-pinned-tabs-v1';
const MAX_PANEL_WIDTH = 1200;
// Two-pane Review (diff list + file-tree rail) is cramped below this.
const TWO_PANE_MIN_WIDTH = 560;

interface SidebarTabDescriptor {
  icon: typeof LayoutDashboardIcon;
  key: string;
  label: ReactNode;
}

const AgentWorkingSidebar = memo(() => {
  const { t } = useTranslation(['chat', 'setting']);
  const [
    storedWidth,
    updateSystemStatus,
    toggleRightPanel,
    toggleTerminalPanel,
    setWorkingSidebarTab,
    showRightPanel,
    storedTab,
    tabRequest,
  ] = useGlobalStore((s) => [
    systemStatusSelectors.workingSidebarWidth(s),
    s.updateSystemStatus,
    s.toggleRightPanel,
    s.toggleTerminalPanel,
    s.setWorkingSidebarTab,
    // Panel open/collapsed state (drives the `<RightPanel>` expand). Used to gate
    // the resources pane's document fetch so a collapsed sidebar doesn't pull the
    // full agent-document list into the conversation's initial batch.
    s.status.showRightPanel,
    s.status.workingSidebarTab,
    s.status.workingSidebarTabRequest,
  ]);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const topicId = useChatStore((s) => s.activeTopicId);
  const isChatMode = useAgentStore((s) =>
    activeAgentId ? chatConfigByIdSelectors.isChatModeById(activeAgentId)(s) : false,
  );
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  // Unified precedence (topic > per-device choice > legacy > device default), so
  // the sidebar resolves the same directory the runtime bar / git status do.
  // The old `topicCwd || legacy agentCwd` pattern missed `workingDirByDevice`,
  // landing on the home fallback for device-bound agents and hiding Review.
  const workingDirectory = useEffectiveWorkingDirectory(activeAgentId);
  // Effective target device for git ops — bound device for remote agents, this
  // machine otherwise. Resolved the same way WorkingDirectoryPicker / GitStatus do.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(activeAgentId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  const repoType = useRepoType(workingDirectory, targetDeviceId);
  const deviceRoutingAvailable = useIsGatewayModeEnabled(activeAgentId);
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // Running against a bound device (remote, or this machine as a device): file
  // tree + git reads go over RPC, so both Review and Files are reachable even
  // when runtimeMode isn't `local`.
  const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
  // `targetDeviceId` also identifies the local desktop for per-device working
  // directory state. Files/Review only need a deviceId when routing through a
  // remote device RPC; local "This device" must keep Electron IPC + file-open
  // actions enabled.
  const remoteDeviceId = isDeviceMode ? agencyConfig.boundDeviceId : undefined;
  const isLocalExecution = effectiveTarget === 'local';
  // Files tab is an agent-mode affordance — in plain chat mode the working
  // directory is irrelevant to the user, so hide the tab even when one resolves.
  const filesAvailable = !isChatMode && (isLocalExecution || isDeviceMode) && !!workingDirectory;
  const reviewAvailable = (isLocalExecution || isDeviceMode) && !!workingDirectory && !!repoType;
  const paramsAvailable = !isHetero;
  // The in-app browser pages are main-process WebContentsViews — desktop only,
  // and gated behind the Labs toggle while the feature matures.
  const enableInAppBrowser = useUserStore(labPreferSelectors.enableInAppBrowser);
  const enableBuiltinTerminal = useUserStore(labPreferSelectors.enableBuiltinTerminal);
  const browserAvailable = isDesktop && enableInAppBrowser;
  const terminalAvailable = isDesktop && enableBuiltinTerminal;
  // Must mint the same key the browser tools do (`sessionIdOf` in
  // builtin-tool-browser), or the user and the agent would be looking at two
  // different pages. A draft topic has no id yet, but the panel is openable
  // there (user types a URL before sending anything), so it borrows a per-agent
  // key until the topic materializes.
  const browserSessionId = topicId
    ? `topic:${topicId}`
    : `draft-agent:${activeAgentId ?? 'default'}`;

  const businessTabs = useBusinessWorkingSidebarTabs({ activeAgentId, topicId });
  const tabDescriptors = useMemo<SidebarTabDescriptor[]>(
    () => [
      { icon: FolderOpenIcon, key: 'resources', label: t('workingPanel.resources') },
      { icon: BoxesIcon, key: 'works', label: t('workingPanel.works.title') },
      ...(reviewAvailable
        ? [{ icon: ClipboardListIcon, key: 'review', label: t('workingPanel.review.title') }]
        : []),
      ...(filesAvailable
        ? [{ icon: FilesIcon, key: 'files', label: t('workingPanel.files.title') }]
        : []),
      ...(browserAvailable
        ? [{ icon: Globe2Icon, key: 'browser', label: t('workingPanel.browser.title') }]
        : []),
      ...(paramsAvailable
        ? [
            {
              icon: Settings2Icon,
              key: 'params',
              label: t('settingModel.params.panel.tab', { ns: 'setting' }),
            },
          ]
        : []),
      ...businessTabs.map((tab) => ({
        icon: PanelsTopLeftIcon,
        key: tab.key,
        label: tab.label,
      })),
    ],
    [browserAvailable, businessTabs, filesAvailable, paramsAvailable, reviewAvailable, t],
  );
  const availableTabs = useMemo(
    () => new Map(tabDescriptors.map((tab) => [tab.key, tab])),
    [tabDescriptors],
  );
  const availableTabsSignature = JSON.stringify(tabDescriptors.map((tab) => tab.key));
  const openTabsContextKey = topicId
    ? `topic:${topicId}`
    : `draft:${activeAgentId ?? 'default'}:${workingDirectory ?? 'none'}`;
  const pinnedTabsAgentKey = activeAgentId ?? 'default';
  const [openTabsByContext, setOpenTabsByContext] = useLocalStorageState<Record<string, string[]>>(
    OPEN_TABS_STORAGE_KEY,
    {},
  );
  const [pinnedTabsByAgent, setPinnedTabsByAgent] = useLocalStorageState<Record<string, string[]>>(
    PINNED_TABS_STORAGE_KEY,
    {},
  );
  const lastTabRequestRef = useRef(tabRequest?.nonce);
  const requestedTab =
    tabRequest &&
    lastTabRequestRef.current !== tabRequest.nonce &&
    tabRequest.tab !== 'overview' &&
    availableTabs.has(tabRequest.tab)
      ? tabRequest.tab
      : undefined;
  const pinnedTabs = useMemo(
    () => (pinnedTabsByAgent[pinnedTabsAgentKey] ?? []).filter((tab) => availableTabs.has(tab)),
    [availableTabs, pinnedTabsAgentKey, pinnedTabsByAgent],
  );
  const pinnedTabsSet = useMemo(() => new Set(pinnedTabs), [pinnedTabs]);
  const openedTabs = Array.from(
    new Set([
      ...pinnedTabs,
      ...(openTabsByContext[openTabsContextKey] ?? []).filter((tab) => availableTabs.has(tab)),
      ...(requestedTab ? [requestedTab] : []),
    ]),
  );
  const openedTabsSignature = openedTabs.join('\0');

  const updateOpenedTabs = useCallback(
    (updater: (tabs: string[]) => string[]) => {
      setOpenTabsByContext((current) => ({
        ...current,
        [openTabsContextKey]: updater(current[openTabsContextKey] ?? []),
      }));
    },
    [openTabsContextKey, setOpenTabsByContext],
  );

  const updatePinnedTabs = useCallback(
    (updater: (tabs: string[]) => string[]) => {
      setPinnedTabsByAgent((current) => ({
        ...current,
        [pinnedTabsAgentKey]: updater(current[pinnedTabsAgentKey] ?? []),
      }));
    },
    [pinnedTabsAgentKey, setPinnedTabsByAgent],
  );

  const openTab = useCallback(
    (tab: string) => {
      if (tab !== 'overview' && !availableTabs.has(tab)) return;
      if (tab !== 'overview') {
        updateOpenedTabs((current) => (current.includes(tab) ? current : [...current, tab]));
      }
      setWorkingSidebarTab(tab);
    },
    [availableTabs, setWorkingSidebarTab, updateOpenedTabs],
  );

  const activeTab: string =
    storedTab && (storedTab === 'overview' || openedTabs.includes(storedTab))
      ? storedTab
      : 'overview';

  useEffect(() => {
    if (!tabRequest || lastTabRequestRef.current === tabRequest.nonce) return;
    if (tabRequest.tab !== 'overview' && !availableTabs.has(tabRequest.tab)) return;

    lastTabRequestRef.current = tabRequest.nonce;
    if (tabRequest.tab !== 'overview') {
      updateOpenedTabs((current) =>
        current.includes(tabRequest.tab) ? current : [...current, tabRequest.tab],
      );
    }
  }, [availableTabs, availableTabsSignature, tabRequest, updateOpenedTabs]);

  const pinTab = useCallback(
    (tab: string) => {
      if (!availableTabs.has(tab)) return;
      updateOpenedTabs((current) => (current.includes(tab) ? current : [...current, tab]));
      updatePinnedTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    },
    [availableTabs, updateOpenedTabs, updatePinnedTabs],
  );

  const unpinTab = useCallback(
    (tab: string) => {
      // A tab restored only through its agent pin should remain open in the
      // current topic after unpinning instead of disappearing immediately.
      updateOpenedTabs((current) => (current.includes(tab) ? current : [...current, tab]));
      updatePinnedTabs((current) => current.filter((item) => item !== tab));
    },
    [updateOpenedTabs, updatePinnedTabs],
  );

  const closeTabs = useCallback(
    (tabs: string[], fallbackTab = 'overview') => {
      const removableTabs = new Set(tabs.filter((tab) => !pinnedTabsSet.has(tab)));
      if (removableTabs.size === 0) return;

      updateOpenedTabs((current) => current.filter((tab) => !removableTabs.has(tab)));
      if (removableTabs.has(activeTab)) setWorkingSidebarTab(fallbackTab);
    },
    [activeTab, pinnedTabsSet, setWorkingSidebarTab, updateOpenedTabs],
  );

  const closeTab = useCallback((tab: string) => closeTabs([tab]), [closeTabs]);

  const displayedTabs = openedTabs
    .map((tab) => availableTabs.get(tab))
    .filter((tab): tab is SidebarTabDescriptor => Boolean(tab));
  const createTabContextMenuItems = useCallback(
    (tab: string, index: number): ContextMenuItem[] => {
      const pinned = pinnedTabsSet.has(tab);
      const leftTabs = openedTabs.slice(0, index);
      const rightTabs = openedTabs.slice(index + 1);
      const otherTabs = openedTabs.filter((item) => item !== tab);
      const hasClosable = (tabs: string[]) => tabs.some((item) => !pinnedTabsSet.has(item));

      return [
        {
          icon: pinned ? PinOffIcon : PinIcon,
          key: pinned ? 'unpin' : 'pin',
          label: t(pinned ? 'workingPanel.tabs.unpin' : 'workingPanel.tabs.pin'),
          onClick: () => (pinned ? unpinTab(tab) : pinTab(tab)),
        },
        { type: 'divider' },
        {
          disabled: pinned,
          icon: XIcon,
          key: 'close',
          label: t('workingPanel.tabs.close'),
          onClick: () => closeTab(tab),
        },
        {
          disabled: !hasClosable(otherTabs),
          key: 'closeOthers',
          label: t('workingPanel.tabs.closeOthers'),
          onClick: () => closeTabs(otherTabs, tab),
        },
        { type: 'divider' },
        {
          disabled: !hasClosable(leftTabs),
          key: 'closeLeft',
          label: t('workingPanel.tabs.closeLeft'),
          onClick: () => closeTabs(leftTabs, tab),
        },
        {
          disabled: !hasClosable(rightTabs),
          key: 'closeRight',
          label: t('workingPanel.tabs.closeRight'),
          onClick: () => closeTabs(rightTabs, tab),
        },
      ];
    },
    [closeTab, closeTabs, openedTabs, pinTab, pinnedTabsSet, t, unpinTab],
  );
  const overviewContextMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        disabled: !openedTabs.some((tab) => !pinnedTabsSet.has(tab)),
        key: 'closeOthers',
        label: t('workingPanel.tabs.closeOthers'),
        onClick: () => closeTabs(openedTabs),
      },
    ],
    [closeTabs, openedTabs, pinnedTabsSet, t],
  );
  const tabsRef = useRef<HTMLDivElement>(null);
  const pendingTabFocusRef = useRef<string | undefined>(undefined);
  const pendingTabFocusTimeoutRef = useRef<number | undefined>(undefined);

  const scrollActiveTabIntoView = useCallback(() => {
    const tabs = tabsRef.current;
    const activeTabButton = tabs?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    const activeTabItem = activeTabButton?.parentElement;
    if (!tabs || !activeTabItem) return;

    const tabsRect = tabs.getBoundingClientRect();
    const activeTabRect = activeTabItem.getBoundingClientRect();
    if (activeTabRect.left < tabsRect.left) {
      tabs.scrollLeft += activeTabRect.left - tabsRect.left;
    } else if (activeTabRect.right > tabsRect.right) {
      tabs.scrollLeft += activeTabRect.right - tabsRect.right;
    }
  }, []);

  const focusPendingTab = useCallback(() => {
    const pendingTab = pendingTabFocusRef.current;
    if (!pendingTab) return;

    const tabButton = Array.from(
      tabsRef.current?.querySelectorAll<HTMLButtonElement>('button[data-tab-key]') ?? [],
    ).find((button) => button.dataset.tabKey === pendingTab);
    if (!tabButton) return;

    if (pendingTabFocusTimeoutRef.current !== undefined) {
      window.clearTimeout(pendingTabFocusTimeoutRef.current);
      pendingTabFocusTimeoutRef.current = undefined;
    }
    tabButton.focus();
    pendingTabFocusRef.current = undefined;
  }, []);

  const requestTabFocus = useCallback(
    (tab: string) => {
      pendingTabFocusRef.current = tab;
      if (pendingTabFocusTimeoutRef.current !== undefined) {
        window.clearTimeout(pendingTabFocusTimeoutRef.current);
      }
      // Base UI normally resolves this through onOpenChangeComplete. A short
      // fallback also covers background Electron windows where transition
      // completion is frame-throttled indefinitely.
      pendingTabFocusTimeoutRef.current = window.setTimeout(() => {
        if (pendingTabFocusRef.current === tab) focusPendingTab();
      }, 300);
    },
    [focusPendingTab],
  );

  useEffect(() => {
    scrollActiveTabIntoView();
  }, [
    activeTab,
    availableTabsSignature,
    openedTabsSignature,
    scrollActiveTabIntoView,
    storedWidth,
    tabRequest?.nonce,
  ]);

  useEffect(
    () => () => {
      if (pendingTabFocusTimeoutRef.current !== undefined) {
        window.clearTimeout(pendingTabFocusTimeoutRef.current);
      }
    },
    [],
  );

  // Review's tree-nav rail lives here (not inside Review) so the panel can widen
  // when the two-pane layout is on. Hidden by default — the panel shows only the
  // diff list until the user opens the tree from the toolbar. Persisted so it
  // survives reloads.
  const [showReviewTree, setShowReviewTree] = useLocalStorageState<boolean>(
    REVIEW_TREE_STORAGE_KEY,
    false,
  );
  // Mount the browser pane on first activation only (no eager page load), then
  // keep it mounted-but-hidden so the page survives tab switches.
  const [browserActivated, setBrowserActivated] = useState(false);
  useEffect(() => {
    if (activeTab === 'browser') setBrowserActivated(true);
  }, [activeTab]);
  const reviewTwoPane = activeTab === 'review' && reviewAvailable && showReviewTree;
  const displayWidth = reviewTwoPane ? Math.max(storedWidth, TWO_PANE_MIN_WIDTH) : storedWidth;
  const openMenuItems = useMemo<DropdownItem[]>(() => {
    const itemOf = (key: string): DropdownItem | undefined => {
      const tab = availableTabs.get(key);
      if (!tab) return undefined;

      return {
        icon: <Icon icon={openedTabs.includes(key) ? CheckIcon : tab.icon} size={14} />,
        key,
        label: tab.label,
        onClick: () => {
          openTab(key);
          requestTabFocus(key);
        },
      };
    };
    const group = (key: string, label: string, keys: string[]): DropdownItem | undefined => {
      const children = keys.map(itemOf).filter((item): item is DropdownItem => Boolean(item));
      return children.length ? { children, key, label, type: 'group' } : undefined;
    };

    const workspaceGroup = group('workspace', t('workingPanel.openMenu.workspace'), [
      'review',
      'files',
      'works',
      'resources',
      ...businessTabs.map((tab) => tab.key),
    ]);
    const toolChildren = [itemOf('browser')].filter((item): item is DropdownItem => Boolean(item));
    if (terminalAvailable) {
      toolChildren.push({
        icon: <Icon icon={SquareTerminalIcon} size={14} />,
        key: 'terminal',
        label: t('workingPanel.openMenu.terminal'),
        onClick: () => toggleTerminalPanel(true),
      });
    }
    const toolGroup = toolChildren.length
      ? {
          children: toolChildren,
          key: 'tools',
          label: t('workingPanel.openMenu.tools'),
          type: 'group' as const,
        }
      : undefined;
    const configurationGroup = group('configuration', t('workingPanel.openMenu.configuration'), [
      'params',
    ]);

    return [workspaceGroup, toolGroup, configurationGroup]
      .filter((item): item is DropdownItem => Boolean(item))
      .flatMap((item, index, items) =>
        index < items.length - 1 ? [item, { type: 'divider' as const }] : [item],
      );
  }, [
    availableTabs,
    businessTabs,
    openTab,
    openedTabs,
    requestTabFocus,
    t,
    terminalAvailable,
    toggleTerminalPanel,
  ]);

  return (
    <RightPanel
      stableLayout
      defaultWidth={displayWidth}
      maxWidth={MAX_PANEL_WIDTH}
      minWidth={300}
      width={displayWidth}
      onSizeChange={(size) => {
        if (!size?.width) return;
        // DraggablePanel emits width as a `"420px"` string on drag-stop; parse it so
        // the controlled width actually updates (otherwise the panel snaps back).
        const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
        if (!Number.isFinite(w) || w === storedWidth) return;
        updateSystemStatus({ workingSidebarWidth: w });
      }}
    >
      <Flexbox height={'100%'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          gap={4}
          height={44}
          justify={'space-between'}
          paddingInline={4}
        >
          <div className={styles.tabs} ref={tabsRef}>
            <WorkspaceTab
              fixed
              active={activeTab === 'overview'}
              contextMenuItems={overviewContextMenuItems}
              icon={LayoutDashboardIcon}
              label={t('workingPanel.overview.title')}
              tabKey={'overview'}
              onSelect={() => openTab('overview')}
            />
            {displayedTabs.map((tab, index) => (
              <WorkspaceTab
                active={activeTab === tab.key}
                closeLabel={t('workingPanel.tabs.close')}
                contextMenuItems={createTabContextMenuItems(tab.key, index)}
                icon={tab.icon}
                key={tab.key}
                label={tab.label}
                pinned={pinnedTabsSet.has(tab.key)}
                pinnedLabel={t('workingPanel.tabs.pinned')}
                tabKey={tab.key}
                onClose={pinnedTabsSet.has(tab.key) ? undefined : () => closeTab(tab.key)}
                onSelect={() => openTab(tab.key)}
              />
            ))}
          </div>
          <DropdownMenu
            items={openMenuItems}
            placement={'bottomRight'}
            onOpenChangeComplete={(open) => {
              if (open) return;
              if (pendingTabFocusRef.current) focusPendingTab();
              else scrollActiveTabIntoView();
            }}
          >
            <ActionIcon
              icon={PlusIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('workingPanel.openMenu.title')}
            />
          </DropdownMenu>
          <ActionIcon
            className={styles.close}
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleRightPanel(false)}
          />
        </Flexbox>
        <Flexbox className={styles.body} width={'100%'}>
          <Flexbox className={activeTab === 'overview' ? styles.pane : styles.paneHidden}>
            <Overview
              active={Boolean(showRightPanel) && activeTab === 'overview'}
              deviceId={remoteDeviceId}
              repoType={repoType}
              workingDirectory={workingDirectory}
              onOpenTab={openTab}
            />
          </Flexbox>
          {paramsAvailable && activeTab === 'params' && (
            <Flexbox className={styles.pane}>
              <Suspense
                fallback={
                  <Skeleton
                    active
                    className={styles.paramsLoading}
                    paragraph={{ rows: 6 }}
                    title={false}
                  />
                }
              >
                <ParamsSection />
              </Suspense>
            </Flexbox>
          )}
          {reviewAvailable && (
            <Flexbox className={activeTab === 'review' ? styles.pane : styles.paneHidden}>
              <Review
                active={activeTab === 'review'}
                deviceId={remoteDeviceId}
                showTree={showReviewTree}
                workingDirectory={workingDirectory}
                onToggleTree={() => setShowReviewTree((v) => !v)}
              />
            </Flexbox>
          )}
          {filesAvailable && (
            <Flexbox className={activeTab === 'files' ? styles.pane : styles.paneHidden}>
              <Files deviceId={remoteDeviceId} workingDirectory={workingDirectory} />
            </Flexbox>
          )}
          {browserAvailable && browserActivated && (
            <Flexbox className={activeTab === 'browser' ? styles.pane : styles.paneHidden}>
              {/* Keyed by session: the pane holds per-session local state (webview,
              address bar), so an agent switch must remount it rather than leak the
              previous agent's page into the new agent's session. */}
              <BrowserPane
                agentId={activeAgentId}
                key={browserSessionId}
                sessionId={browserSessionId}
              />
            </Flexbox>
          )}
          {businessTabs.map((tab) => (
            <Flexbox
              className={activeTab === tab.key ? styles.pane : styles.paneHidden}
              key={tab.key}
            >
              {tab.pane}
            </Flexbox>
          ))}
          <Flexbox
            className={activeTab === 'resources' ? styles.pane : styles.paneHidden}
            width={'100%'}
          >
            <ResourcesSection
              deviceId={remoteDeviceId}
              enabled={showRightPanel && activeTab === 'resources'}
            />
          </Flexbox>
          <Flexbox className={activeTab === 'works' ? styles.pane : styles.paneHidden}>
            <WorksSection active={showRightPanel && activeTab === 'works'} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </RightPanel>
  );
});

export default AgentWorkingSidebar;
