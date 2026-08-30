import type { SFSymbol } from '@lobechat/electron-client-ipc';
import { nanoid } from '@lobechat/utils';
import { Flexbox, Icon, type IconProps, Skeleton } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  BoxesIcon,
  CheckIcon,
  ClipboardListIcon,
  FilesIcon,
  FileTextIcon,
  Globe2Icon,
  GlobeIcon,
  MessageCircleIcon,
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
  Activity,
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
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { useRepoType } from '@/features/ChatInput/ControlBar/useRepoType';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { getPortalViewWidth } from '@/features/Portal/portalWidth';
import TopicCommentsSidebar from '@/features/Portal/TopicComments/Sidebar';
import RightPanel from '@/features/RightPanel';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useDeferredMount } from '@/hooks/useDeferredMount';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import type { NativeContextMenuItem } from '@/libs/contextMenu/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, portalThreadSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { type ComposerTarget, createComposerTarget, resolveThreadComposerTarget } from '../types';
import Files from './Files';
import { sidebarWidthBudget } from './fitsBesidePortal';
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
  add: css`
    flex-shrink: 0;
  `,
  favicon: css`
    width: 14px;
    height: 14px;
    border-radius: 2px;
    object-fit: contain;
  `,
  overviewBody: css`
    overflow-y: auto;
    min-height: 0;
  `,
  overviewHeader: css`
    flex-shrink: 0;
    padding-block: 6px;
    padding-inline: 12px 8px;
  `,
  overviewPanel: css`
    overflow: hidden;
    flex-shrink: 0;
    align-self: flex-start;

    width: min(340px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    margin: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  overviewTitle: css`
    overflow: hidden;
    flex: 1;

    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tabs: css`
    overflow-anchor: none;
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    gap: 4px;
    align-items: center;

    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  /* keeps the add button glued to the last tab while the strip itself scrolls */
  tabsArea: css`
    display: flex;
    flex: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;
  `,
}));

const REVIEW_TREE_STORAGE_KEY = 'lobechat-review-tree';
const OPEN_TABS_STORAGE_KEY = 'lobechat-working-sidebar-open-tabs-v1';
const PINNED_TABS_STORAGE_KEY = 'lobechat-working-sidebar-pinned-tabs-v1';
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 1200;
// Two-pane Review (diff list + file-tree rail) is cramped below this.
const TWO_PANE_MIN_WIDTH = 560;

interface SidebarTabDescriptor {
  icon: IconProps['icon'];
  iconNode?: ReactNode;
  key: string;
  label: ReactNode;
}

interface BrowserTabMetadata {
  faviconUrl?: string;
  title: string;
  url: string;
}

const BROWSER_TAB_KEY = 'browser';
const BROWSER_TAB_PREFIX = 'browser:';
const isBrowserTab = (tab: string) => tab === BROWSER_TAB_KEY || tab.startsWith(BROWSER_TAB_PREFIX);

interface AgentWorkingSidebarProps {
  /**
   * Measured width of the row this sidebar shares with the conversation and the
   * portal. Undefined until the layout has measured it.
   */
  availableWidth?: number;
}

const AgentWorkingSidebar = memo<AgentWorkingSidebarProps>(({ availableWidth }) => {
  const { t } = useTranslation(['chat', 'setting']);
  // Keep the panel frame + tabs on the navigation commit; the pane contents
  // mount in a deferred follow-up pass behind a skeleton.
  const contentReady = useDeferredMount();
  const [
    storedWidth,
    legacyPortalWidth,
    portalWidths,
    updateSystemStatus,
    toggleRightPanel,
    openWorkingSidebar,
    toggleTerminalPanel,
    setWorkingSidebarTab,
    showRightPanel,
    showWorkingOverview,
    storedTab,
    tabRequest,
  ] = useGlobalStore((s) => [
    systemStatusSelectors.workingSidebarWidth(s),
    systemStatusSelectors.portalWidth(s),
    systemStatusSelectors.portalWidths(s),
    s.updateSystemStatus,
    s.toggleRightPanel,
    s.openWorkingSidebar,
    s.toggleTerminalPanel,
    s.setWorkingSidebarTab,
    // Panel open/collapsed state (drives the `<RightPanel>` expand). Used to gate
    // the resources pane's document fetch so a collapsed sidebar doesn't pull the
    // full agent-document list into the conversation's initial batch.
    s.status.showRightPanel,
    s.status.showWorkingOverview ?? !s.status.showRightPanel,
    s.status.workingSidebarTab,
    s.status.workingSidebarTabRequest,
  ]);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const workspaceId = useActiveWorkspaceId();
  const [
    topicId,
    currentPortalView,
    portalOpen,
    openTopicComments,
    portalThread,
    chatAgentId,
    chatGroupId,
    chatThreadId,
  ] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.currentView(s),
    chatPortalSelectors.showStandalonePortal(s),
    s.openTopicComments,
    portalThreadSelectors.portalCurrentThread(s),
    s.activeAgentId,
    s.activeGroupId,
    s.activeThreadId,
  ]);
  const composerTarget = useMemo<ComposerTarget>(() => {
    if (!portalOpen || currentPortalView?.type !== PortalViewType.Thread) {
      return createComposerTarget(
        messageMapKey({
          agentId: chatAgentId,
          groupId: chatGroupId,
          threadId: chatThreadId,
          topicId,
        }),
      );
    }

    return resolveThreadComposerTarget({
      contextKey: messageMapKey({
        agentId: chatAgentId,
        isNew: !currentPortalView.threadId,
        scope: 'thread',
        threadId: currentPortalView.threadId,
        topicId,
      }),
      metadataResolved: !currentPortalView.threadId || !!portalThread,
      sourceToolCallId: portalThread?.metadata?.sourceToolCallId,
    });
  }, [
    chatAgentId,
    chatGroupId,
    chatThreadId,
    currentPortalView,
    portalOpen,
    portalThread,
    topicId,
  ]);
  const portalWidth = getPortalViewWidth({
    legacyWidth: legacyPortalWidth,
    viewType: currentPortalView?.type,
    widths: portalWidths,
  });
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
  const filesystemEnvironmentAvailable = isLocalExecution || isDeviceMode;
  const environmentWorkingDirectory = filesystemEnvironmentAvailable ? workingDirectory : undefined;
  const environmentRepoType = filesystemEnvironmentAvailable ? repoType : undefined;
  // Files tab is an agent-mode affordance — in plain chat mode the working
  // directory is irrelevant to the user, so hide the tab even when one resolves.
  const filesAvailable = !isChatMode && (isLocalExecution || isDeviceMode) && !!workingDirectory;
  const reviewAvailable = (isLocalExecution || isDeviceMode) && !!workingDirectory && !!repoType;
  const paramsAvailable = !isHetero;
  // The in-app browser pages are renderer-retained Electron webviews — desktop only.
  const browserAvailable = isDesktop;
  const terminalAvailable = isDesktop;
  // Must mint the same key the browser tools do (`sessionIdOf` in
  // builtin-tool-browser), or the user and the agent would be looking at two
  // different pages. A draft topic has no id yet, but the panel is openable
  // there (user types a URL before sending anything), so it borrows a per-agent
  // key until the topic materializes.
  const browserSessionId = topicId
    ? `topic:${topicId}`
    : `draft-agent:${activeAgentId ?? 'default'}`;
  const [browserTabMetadata, setBrowserTabMetadata] = useState<Record<string, BrowserTabMetadata>>(
    {},
  );

  const businessTabs = useBusinessWorkingSidebarTabs({ activeAgentId, topicId });
  const commentsAvailable = !!workspaceId && !!topicId;
  const currentCommentTopicId =
    currentPortalView?.type === PortalViewType.TopicComments ||
    currentPortalView?.type === PortalViewType.TopicCommentThread
      ? currentPortalView.topicId
      : undefined;
  const isCurrentTopicComments = currentCommentTopicId === topicId;
  const tabDescriptors = useMemo<SidebarTabDescriptor[]>(
    () => [
      { icon: SkillsIcon, key: 'skills', label: t('workingPanel.resources.filter.skills') },
      // Documents / web resources are agent-document features — heterogeneous
      // agents only carry filesystem skills, so hide both tabs there.
      ...(isHetero
        ? []
        : [
            {
              icon: FileTextIcon,
              key: 'documents',
              label: t('workingPanel.resources.filter.documents'),
            },
            { icon: GlobeIcon, key: 'web', label: t('workingPanel.resources.filter.web') },
          ]),
      { icon: BoxesIcon, key: 'works', label: t('workingPanel.works.title') },
      ...(commentsAvailable
        ? [{ icon: MessageCircleIcon, key: 'comments', label: t('topicComment.title') }]
        : []),
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
    [
      browserAvailable,
      businessTabs,
      commentsAvailable,
      filesAvailable,
      isHetero,
      paramsAvailable,
      reviewAvailable,
      t,
    ],
  );
  const availableTabs = useMemo(
    () => new Map(tabDescriptors.map((tab) => [tab.key, tab])),
    [tabDescriptors],
  );
  const availableTabsSignature = JSON.stringify(tabDescriptors.map((tab) => tab.key));
  const isAvailableTab = useCallback(
    (tab: string) => availableTabs.has(tab) || (browserAvailable && isBrowserTab(tab)),
    [availableTabs, browserAvailable],
  );
  const openTabsContextKey = topicId
    ? `topic:${topicId}`
    : `draft:${activeAgentId ?? 'default'}:${workingDirectory ?? 'none'}`;
  const pinnedTabsAgentKey = activeAgentId ?? 'default';
  const defaultOpenedTabs = useMemo(
    () =>
      [filesAvailable ? 'files' : undefined, 'skills', isHetero ? undefined : 'documents'].filter(
        (tab): tab is string => Boolean(tab) && isAvailableTab(tab!),
      ),
    [filesAvailable, isAvailableTab, isHetero],
  );
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
    isAvailableTab(tabRequest.tab)
      ? tabRequest.tab
      : undefined;
  const pinnedTabs = useMemo(
    () =>
      (pinnedTabsByAgent[pinnedTabsAgentKey] ?? []).filter(
        (tab) => !isBrowserTab(tab) && isAvailableTab(tab),
      ),
    [isAvailableTab, pinnedTabsAgentKey, pinnedTabsByAgent],
  );
  const pinnedTabsSet = useMemo(() => new Set(pinnedTabs), [pinnedTabs]);
  const openedTabs = Array.from(
    new Set([
      ...pinnedTabs,
      ...(openTabsByContext[openTabsContextKey] ?? defaultOpenedTabs).filter(isAvailableTab),
      ...(requestedTab ? [requestedTab] : []),
    ]),
  );
  const openedTabsSignature = openedTabs.join('\0');
  const [optimisticSelection, setOptimisticSelection] = useState<{
    contextKey: string;
    tab: string;
  }>();
  const previousStoredTabRef = useRef(storedTab);
  const resolvedActiveTab: string =
    storedTab && openedTabs.includes(storedTab) ? storedTab : (openedTabs[0] ?? 'overview');
  const activeTab =
    optimisticSelection?.contextKey === openTabsContextKey
      ? optimisticSelection.tab
      : resolvedActiveTab;

  const updateOpenedTabs = useCallback(
    (updater: (tabs: string[]) => string[]) => {
      setOpenTabsByContext((current) => ({
        ...current,
        [openTabsContextKey]: updater(current[openTabsContextKey] ?? defaultOpenedTabs),
      }));
    },
    [defaultOpenedTabs, openTabsContextKey, setOpenTabsByContext],
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
      if (tab !== 'overview' && !isAvailableTab(tab)) return;
      if (tab !== activeTab) setOptimisticSelection({ contextKey: openTabsContextKey, tab });
      if (tab !== 'overview') {
        updateOpenedTabs((current) => (current.includes(tab) ? current : [...current, tab]));
        openWorkingSidebar(tab);
      }
      if (tab === 'comments' && topicId && !isCurrentTopicComments) {
        openTopicComments(topicId);
        return;
      }
      if (tab === 'overview') setWorkingSidebarTab(tab);
    },
    [
      isAvailableTab,
      isCurrentTopicComments,
      openTopicComments,
      setWorkingSidebarTab,
      topicId,
      activeTab,
      openWorkingSidebar,
      openTabsContextKey,
      updateOpenedTabs,
    ],
  );

  const openBrowserTab = useCallback(() => {
    if (!browserAvailable) return undefined;
    const currentBrowserTabs = (openTabsByContext[openTabsContextKey] ?? []).filter(isBrowserTab);
    const tab =
      currentBrowserTabs.length === 0 ? BROWSER_TAB_KEY : `${BROWSER_TAB_PREFIX}${nanoid(8)}`;
    updateOpenedTabs((current) => [...current, tab]);
    setOptimisticSelection({ contextKey: openTabsContextKey, tab });
    openWorkingSidebar(tab);
    return tab;
  }, [
    browserAvailable,
    openTabsByContext,
    openTabsContextKey,
    openWorkingSidebar,
    updateOpenedTabs,
  ]);

  useEffect(() => {
    if (previousStoredTabRef.current === storedTab) return;
    previousStoredTabRef.current = storedTab;
    setOptimisticSelection(undefined);
  }, [storedTab]);

  useEffect(() => {
    setOptimisticSelection(undefined);
  }, [availableTabsSignature, openTabsContextKey]);

  useEffect(() => {
    if (
      activeTab !== 'comments' ||
      !topicId ||
      (!currentCommentTopicId && currentPortalView) ||
      isCurrentTopicComments
    )
      return;

    openTopicComments(topicId);
  }, [
    activeTab,
    currentCommentTopicId,
    currentPortalView,
    isCurrentTopicComments,
    openTopicComments,
    topicId,
  ]);

  useEffect(() => {
    if (!tabRequest || lastTabRequestRef.current === tabRequest.nonce) return;
    if (tabRequest.tab !== 'overview' && !isAvailableTab(tabRequest.tab)) return;

    lastTabRequestRef.current = tabRequest.nonce;
    if (tabRequest.tab !== 'overview') {
      updateOpenedTabs((current) =>
        current.includes(tabRequest.tab) ? current : [...current, tabRequest.tab],
      );
    }
  }, [availableTabsSignature, isAvailableTab, tabRequest, updateOpenedTabs]);

  const pinTab = useCallback(
    (tab: string) => {
      if (!availableTabs.has(tab) || isBrowserTab(tab)) return;
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

      const remainingTabs = openedTabs.filter((tab) => !removableTabs.has(tab));
      updateOpenedTabs(() => remainingTabs);
      if (removableTabs.has(activeTab)) {
        const nextTab = remainingTabs.includes(fallbackTab)
          ? fallbackTab
          : (remainingTabs[0] ?? 'overview');
        setOptimisticSelection({ contextKey: openTabsContextKey, tab: nextTab });
        setWorkingSidebarTab(nextTab);
      }
      if (remainingTabs.length === 0) {
        toggleRightPanel(false);
      }
    },
    [
      activeTab,
      openedTabs,
      openTabsContextKey,
      pinnedTabsSet,
      setWorkingSidebarTab,
      toggleRightPanel,
      updateOpenedTabs,
    ],
  );

  const closeTab = useCallback((tab: string) => closeTabs([tab]), [closeTabs]);

  const displayedTabs = openedTabs
    .map((tab): SidebarTabDescriptor | undefined => {
      if (!isBrowserTab(tab)) return availableTabs.get(tab);
      const metadata = browserTabMetadata[`${openTabsContextKey}:${tab}`];
      const fallbackLabel = t('workingPanel.browser.title');
      const label = metadata?.title?.trim() || fallbackLabel;
      return {
        icon: Globe2Icon,
        iconNode: metadata?.faviconUrl ? (
          <img alt="" className={styles.favicon} src={metadata.faviconUrl} />
        ) : undefined,
        key: tab,
        label,
      };
    })
    .filter((tab): tab is SidebarTabDescriptor => Boolean(tab));
  const createTabContextMenuItems = useCallback(
    (tab: string, index: number): NativeContextMenuItem[] => {
      const pinned = pinnedTabsSet.has(tab);
      const leftTabs = openedTabs.slice(0, index);
      const rightTabs = openedTabs.slice(index + 1);
      const otherTabs = openedTabs.filter((item) => item !== tab);
      const hasClosable = (tabs: string[]) => tabs.some((item) => !pinnedTabsSet.has(item));

      return [
        ...(!isBrowserTab(tab)
          ? [
              {
                icon: pinned ? PinOffIcon : PinIcon,
                key: pinned ? 'unpin' : 'pin',
                label: t(pinned ? 'workingPanel.tabs.unpin' : 'workingPanel.tabs.pin'),
                onClick: () => (pinned ? unpinTab(tab) : pinTab(tab)),
                sfSymbol: (pinned ? 'pin.slash' : 'pin') satisfies SFSymbol,
              } as NativeContextMenuItem,
              { type: 'divider' as const },
            ]
          : []),
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
  const reviewTwoPane = activeTab === 'review' && reviewAvailable && showReviewTree;
  const displayWidth = reviewTwoPane ? Math.max(storedWidth, TWO_PANE_MIN_WIDTH) : storedWidth;
  // Yield the row to conversation + portal when the three no longer fit. A
  // stored width that merely outgrew the current row (the user dragged the
  // panel out, or resized the window down) renders clamped instead of
  // unmounting the whole panel — the sidebar disappears only when even its
  // minimum width leaves no room for the conversation. Either way this only
  // overrides the rendered state — `showRightPanel` keeps the user's own
  // choice, so the sidebar comes back by itself once there is room again.
  const minDisplayWidth = reviewTwoPane ? TWO_PANE_MIN_WIDTH : MIN_PANEL_WIDTH;
  const widthBudget = sidebarWidthBudget({
    availableWidth,
    portalWidth: portalOpen ? portalWidth : 0,
  });
  const fits = widthBudget >= minDisplayWidth;
  const overviewFits = widthBudget >= MIN_PANEL_WIDTH;
  const renderWidth = Math.min(displayWidth, Math.max(widthBudget, minDisplayWidth));
  // Also cap the drag range so releasing a drag can never persist a width that
  // immediately fails the fit check and hides the panel.
  const maxPanelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(widthBudget, minDisplayWidth));
  const openMenuItems = useCallback((): DropdownItem[] => {
    const itemOf = (key: string): DropdownItem | undefined => {
      const tab = availableTabs.get(key);
      if (!tab) return undefined;

      if (key === BROWSER_TAB_KEY) {
        return {
          icon: <Icon icon={tab.icon} size={14} />,
          key,
          label: tab.label,
          onClick: () => {
            const browserTab = openBrowserTab();
            if (browserTab) requestTabFocus(browserTab);
          },
        };
      }

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
    const groupLabel = (label: string) => <span style={{ textTransform: 'none' }}>{label}</span>;
    const group = (key: string, label: string, keys: string[]): DropdownItem | undefined => {
      const children = keys.map(itemOf).filter((item): item is DropdownItem => Boolean(item));
      return children.length
        ? { children, key, label: groupLabel(label), type: 'group' }
        : undefined;
    };

    const workspaceGroup = group('workspace', t('workingPanel.openMenu.workspace'), [
      'review',
      'files',
      'works',
      'comments',
      'skills',
      'documents',
      'web',
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
          label: groupLabel(t('workingPanel.openMenu.tools')),
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
    openBrowserTab,
    openTab,
    openedTabs,
    requestTabFocus,
    t,
    terminalAvailable,
    toggleTerminalPanel,
  ]);

  const overviewPanel = showWorkingOverview && overviewFits && (
    <Flexbox className={styles.overviewPanel} role={'complementary'}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.overviewHeader}
        gap={8}
        justify={'space-between'}
      >
        <span className={styles.overviewTitle}>{t('workingPanel.overview.title')}</span>
        <ActionIcon
          aria-label={t('workingPanel.tabs.closePanel')}
          icon={XIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('workingPanel.tabs.closePanel')}
          onClick={() => updateSystemStatus({ showWorkingOverview: false })}
        />
      </Flexbox>
      <Flexbox className={styles.overviewBody}>
        {!contentReady && <SkeletonList paddingBlock={8} paddingInline={8} rows={6} />}
        {contentReady && (
          <Overview
            active
            deviceId={remoteDeviceId}
            environmentAvailable={filesystemEnvironmentAvailable}
            repoType={environmentRepoType}
            workingDirectory={environmentWorkingDirectory}
            onOpenTab={openTab}
          />
        )}
      </Flexbox>
    </Flexbox>
  );

  return (
    <>
      {overviewPanel}
      <RightPanel
        stableLayout
        collapseThreshold={320}
        defaultWidth={renderWidth}
        expand={Boolean(showRightPanel) && fits}
        maxWidth={maxPanelWidth}
        minWidth={MIN_PANEL_WIDTH}
        style={!showRightPanel ? { visibility: 'hidden' } : undefined}
        width={renderWidth}
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
            <div className={styles.tabsArea}>
              <div className={styles.tabs} ref={tabsRef}>
                {displayedTabs.map((tab, index) => (
                  <WorkspaceTab
                    active={activeTab === tab.key}
                    closeLabel={t('workingPanel.tabs.close')}
                    contextMenuItems={createTabContextMenuItems(tab.key, index)}
                    icon={tab.icon}
                    iconNode={tab.iconNode}
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
                  className={styles.add}
                  icon={PlusIcon}
                  size={DESKTOP_HEADER_ICON_SMALL_SIZE}
                  title={t('workingPanel.openMenu.title')}
                />
              </DropdownMenu>
            </div>
            <ActionIcon
              className={styles.close}
              icon={PanelRightCloseIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              onClick={() => toggleRightPanel(false)}
            />
          </Flexbox>
          <Flexbox className={styles.body} width={'100%'}>
            {!contentReady && <SkeletonList paddingBlock={8} paddingInline={8} rows={6} />}
            {contentReady && (
              <>
                {commentsAvailable && (
                  <Flexbox
                    className={activeTab === 'comments' ? styles.pane : styles.paneHidden}
                    style={{ overflow: 'hidden' }}
                  >
                    <TopicCommentsSidebar />
                  </Flexbox>
                )}
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
                      composerTarget={composerTarget}
                      deviceId={remoteDeviceId}
                      showTree={showReviewTree}
                      workingDirectory={workingDirectory}
                      onToggleTree={() => setShowReviewTree((v) => !v)}
                    />
                  </Flexbox>
                )}
                {filesAvailable && (
                  <Activity mode={showRightPanel && activeTab === 'files' ? 'visible' : 'hidden'}>
                    <Flexbox className={styles.pane}>
                      <Files deviceId={remoteDeviceId} workingDirectory={workingDirectory} />
                    </Flexbox>
                  </Activity>
                )}
                {browserAvailable &&
                  openedTabs.filter(isBrowserTab).map((tab) => {
                    const sessionId =
                      tab === BROWSER_TAB_KEY
                        ? browserSessionId
                        : `${browserSessionId}:tab:${tab.slice(BROWSER_TAB_PREFIX.length)}`;

                    return (
                      <Flexbox
                        className={activeTab === tab ? styles.pane : styles.paneHidden}
                        key={sessionId}
                      >
                        <BrowserPane
                          agentId={activeAgentId}
                          composerTarget={composerTarget}
                          sessionId={sessionId}
                          onMetadataChange={(metadata) => {
                            const metadataKey = `${openTabsContextKey}:${tab}`;
                            setBrowserTabMetadata((current) =>
                              current[metadataKey]?.faviconUrl === metadata.faviconUrl &&
                              current[metadataKey]?.title === metadata.title &&
                              current[metadataKey]?.url === metadata.url
                                ? current
                                : { ...current, [metadataKey]: metadata },
                            );
                          }}
                        />
                      </Flexbox>
                    );
                  })}
                {businessTabs.map((tab) => (
                  <Flexbox
                    className={activeTab === tab.key ? styles.pane : styles.paneHidden}
                    key={tab.key}
                  >
                    {tab.pane}
                  </Flexbox>
                ))}
                {/* Resource/works panes stay mounted to keep their state, but hidden ones
           go through Activity so their updates render at background priority
           instead of blocking visible commits (BrowserPane must NOT move here —
           hiding it would unmount the effects keeping its session alive). */}
                {['skills', ...(isHetero ? [] : ['documents', 'web'])].map((resourceTab) => (
                  <Activity
                    key={resourceTab}
                    mode={showRightPanel && activeTab === resourceTab ? 'visible' : 'hidden'}
                  >
                    <Flexbox className={styles.pane} width={'100%'}>
                      <ResourcesSection
                        deviceId={remoteDeviceId}
                        enabled={showRightPanel && activeTab === resourceTab}
                        filter={resourceTab as 'skills' | 'documents' | 'web'}
                      />
                    </Flexbox>
                  </Activity>
                ))}
                <Activity mode={showRightPanel && activeTab === 'works' ? 'visible' : 'hidden'}>
                  <Flexbox className={styles.pane}>
                    <WorksSection active={showRightPanel && activeTab === 'works'} />
                  </Flexbox>
                </Activity>
              </>
            )}
          </Flexbox>
        </Flexbox>
      </RightPanel>
    </>
  );
});

export default AgentWorkingSidebar;
