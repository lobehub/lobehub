import { getWorkingDirEffectivePath } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { ActionIcon, type DropdownItem, DropdownMenu, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
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
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  SquareTerminalIcon,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import {
  Activity,
  lazy,
  memo,
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
import {
  getPullRequestState,
  PR_STATE_VISUAL,
} from '@/features/AgentSidebar/Topic/List/Item/metaCardData';
import { useRepoType } from '@/features/ChatInput/ControlBar/useRepoType';
import { getPortalViewWidth } from '@/features/Portal/portalWidth';
import TopicCommentsSidebar from '@/features/Portal/TopicComments/Sidebar';
import RightPanel from '@/features/RightPanel';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useDeferredMount } from '@/hooks/useDeferredMount';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useFindInTopicHotkey } from '@/hooks/useHotkeys';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, portalThreadSelectors, topicSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { type ComposerTarget, createComposerTarget, resolveThreadComposerTarget } from '../types';
import DeferredSkeleton from './DeferredSkeleton';
import DynamicTabPanes, { dynamicTabDescriptor } from './DynamicTabPanes';
import {
  BROWSER_TAB_KEY,
  BROWSER_TAB_PREFIX,
  type BrowserTabMetadata,
  isBrowserTab,
  isCanvasTab,
  isDynamicTab,
  type SidebarTabDescriptor,
} from './dynamicTabs';
import FilesPane from './Files/FilesPane';
import { useFilesPaneLocation } from './Files/useFilesPaneLocation';
import { sidebarWidthBudget } from './fitsBesidePortal';
import { CANVAS_MIN_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, OVERVIEW_PANEL_WIDTH } from './layout';
import Overview from './Overview';
import { getStatusDeviceId } from './Overview/overviewData';
import OverviewSlot from './OverviewSlot';
import PullRequest from './PullRequest';
import { useLinkedPullRequest } from './PullRequest/useLinkedPullRequest';
import ResourcesSection from './ResourcesSection';
import Review from './Review';
import { TopicSearchPane } from './Search';
import { useSandboxFilesDirectory } from './useSandboxFilesDirectory';
import { useTabContextMenuItems } from './useTabContextMenuItems';
import WorkspaceTab from './WorkspaceTab';
import WorksSection from './WorksSection';

const ParamsSection = lazy(() => import('./ParamsSection'));

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
  overviewBody: css`
    overflow-y: auto;
    min-height: 0;
  `,
  overviewPanel: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    max-height: calc(100% - 32px);
    margin: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  overviewSlot: css`
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
    align-items: flex-start;

    height: 100%;

    @container agent-chat-layout (min-width: 1200px) {
      padding-block-start: 44px;
    }
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
const OVERVIEW_TRANSITION = { duration: 0.25, ease: [0.32, 0.72, 0, 1] } as const;
// Two-pane Review (diff list + file-tree rail) is cramped below this.
const TWO_PANE_MIN_WIDTH = 560;

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
    systemStatusSelectors.showWorkingOverview(s),
    s.status.workingSidebarTab,
    s.status.workingSidebarTabRequest,
  ]);
  const overviewExitTransition = showRightPanel
    ? { ...OVERVIEW_TRANSITION, duration: 0.1 }
    : OVERVIEW_TRANSITION;
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
  // The SOURCE repo, not the checkout — same fallback chain as
  // WorkingDirectorySection: a persisted-worktree topic has no matching
  // `workingDirs` entry, and committing the worktree path as sourcePath would
  // rewrite the topic's repo source (see that component's comment).
  const topicWorkingDirectoryConfig = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.workingDirectoryConfig,
  );
  const topicDeviceId = useChatStore((s) => topicSelectors.currentTopicMetadata(s)?.boundDeviceId);
  const deviceDirs = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const sourceWorkingDirectory = useMemo(() => {
    if (!workingDirectory) return undefined;
    const currentEntry = deviceDirs.find(
      (entry) =>
        (getWorkingDirectoryPathString(entry.git?.activeWorktree) ??
          getWorkingDirectoryPathString(entry.path)) === workingDirectory,
    );
    const persistedConfig =
      getWorkingDirEffectivePath(topicWorkingDirectoryConfig) === workingDirectory
        ? topicWorkingDirectoryConfig
        : undefined;
    return (
      getWorkingDirectoryPathString(currentEntry?.path) ??
      getWorkingDirectoryPathString(persistedConfig?.path) ??
      workingDirectory
    );
  }, [deviceDirs, topicWorkingDirectoryConfig, workingDirectory]);
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
  // `targetDeviceId` also names the local desktop (directory state, Overview status).
  // Files/Review route a deviceId only for remote RPC; "This device" keeps Electron IPC.
  const remoteDeviceId = isDeviceMode ? agencyConfig.boundDeviceId : undefined;
  const isLocalExecution = effectiveTarget === 'local';
  // A cloud-sandbox run that keeps files has a tree on the drive to show too.
  const {
    active: isSandboxExecution,
    directory: sandboxDirectory,
    directoryKnown: sandboxDirectoryKnown,
    instanceId: sandboxInstanceId,
    topicId: sandboxTopicId,
  } = useSandboxFilesDirectory(activeAgentId ?? '', {
    isSandboxTarget: effectiveTarget === 'sandbox',
    topicId,
  });

  const filesystemEnvironmentAvailable = isLocalExecution || isDeviceMode;
  const environmentWorkingDirectory = filesystemEnvironmentAvailable ? workingDirectory : undefined;
  const environmentRepoType = filesystemEnvironmentAvailable ? repoType : undefined;
  // Files is agent-mode only; the hook owns which directory (if any) is showable.
  const { deviceId: filesDeviceId, directory: filesDirectory } = useFilesPaneLocation({
    activeAgentId,
    filesystemEnvironmentAvailable,
    isSandboxExecution,
    remoteDeviceId,
    sandboxDirectory,
    sandboxDirectoryKnown,
    sandboxInstanceId,
    sandboxTopicId,
    topicId,
    workingDirectory,
  });
  const filesAvailable = !isChatMode && filesDirectory !== undefined;
  const reviewAvailable = (isLocalExecution || isDeviceMode) && !!workingDirectory && !!repoType;
  const snapshotConfig =
    (topicDeviceId ? topicDeviceId === targetDeviceId : isLocalExecution) &&
    getWorkingDirEffectivePath(topicWorkingDirectoryConfig) === workingDirectory
      ? topicWorkingDirectoryConfig
      : deviceDirs.find((entry) => getWorkingDirEffectivePath(entry) === workingDirectory);
  const isGithub =
    repoType === 'github' || (!repoType && !!snapshotConfig?.git?.github?.pullRequest);
  const gitPath = filesystemEnvironmentAvailable && isGithub ? workingDirectory : undefined;
  const {
    pullRequest,
    refresh: refreshPullRequest,
    ...pullRequestLink // confirmed, confirmError, onRetryConfirm
  } = useLinkedPullRequest({
    available: filesystemEnvironmentAvailable && !!workingDirectory,
    deviceId: remoteDeviceId,
    gitPath,
    isGithub,
    snapshot: snapshotConfig?.git,
  });
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
  const searchAvailable = !!topicId;
  useFindInTopicHotkey(searchAvailable);
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
      ...(searchAvailable
        ? [{ icon: SearchIcon, key: 'search', label: t('workingPanel.search.title') }]
        : []),
      ...(commentsAvailable
        ? [{ icon: MessageCircleIcon, key: 'comments', label: t('topicComment.title') }]
        : []),
      ...(reviewAvailable
        ? [{ icon: ClipboardListIcon, key: 'review', label: t('workingPanel.review.title') }]
        : []),
      ...(pullRequest
        ? [
            {
              icon: PR_STATE_VISUAL[getPullRequestState(pullRequest)].icon,
              key: 'pr',
              label: `#${pullRequest.number}`,
            },
          ]
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
      pullRequest,
      reviewAvailable,
      searchAvailable,
      t,
    ],
  );
  const availableTabs = useMemo(
    () => new Map(tabDescriptors.map((tab) => [tab.key, tab])),
    [tabDescriptors],
  );
  const availableTabsSignature = JSON.stringify(tabDescriptors.map((tab) => tab.key));
  const isAvailableTab = useCallback(
    (tab: string) =>
      availableTabs.has(tab) || (browserAvailable && isBrowserTab(tab)) || isCanvasTab(tab),
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
        (tab) => !isDynamicTab(tab) && isAvailableTab(tab),
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
      if (!availableTabs.has(tab) || isDynamicTab(tab)) return;
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
    .map(
      (tab) =>
        dynamicTabDescriptor(
          tab,
          browserTabMetadata[`${openTabsContextKey}:${tab}`],
          t('workingPanel.browser.title'),
        ) ?? availableTabs.get(tab),
    )
    .filter((tab): tab is SidebarTabDescriptor => Boolean(tab));
  const createTabContextMenuItems = useTabContextMenuItems({
    closeTab,
    closeTabs,
    openedTabs,
    pinTab,
    pinnedTabsSet,
    unpinTab,
  });
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
  const preferredMinWidth = reviewTwoPane
    ? TWO_PANE_MIN_WIDTH
    : isCanvasTab(activeTab)
      ? CANVAS_MIN_WIDTH
      : 0;
  const displayWidth = Math.max(storedWidth, preferredMinWidth);
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
      'search',
      'review',
      'pr',
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

  const overviewWidth = Math.min(OVERVIEW_PANEL_WIDTH, widthBudget - 32);
  const overviewPanel = (
    <OverviewSlot>
      <AnimatePresence initial={false}>
        {showWorkingOverview && overviewFits && (
          <m.div
            animate={{ width: overviewWidth + 32 }}
            className={styles.overviewSlot}
            exit={{ transition: overviewExitTransition, width: 0 }}
            initial={{ width: 0 }}
            transition={OVERVIEW_TRANSITION}
          >
            <m.div
              animate={{ opacity: 1, x: 0 }}
              className={styles.overviewPanel}
              exit={{ opacity: 0, transition: overviewExitTransition, x: 12 }}
              initial={{ opacity: 0, x: 12 }}
              role={'complementary'}
              style={{ width: overviewWidth }}
              transition={OVERVIEW_TRANSITION}
            >
              <Flexbox className={styles.overviewBody}>
                <Overview
                  active
                  agentId={activeAgentId}
                  deviceId={remoteDeviceId}
                  environmentAvailable={filesystemEnvironmentAvailable}
                  pullRequest={pullRequest}
                  repoType={environmentRepoType}
                  sourcePath={sourceWorkingDirectory}
                  statusDeviceId={getStatusDeviceId(effectiveTarget, agencyConfig?.boundDeviceId)}
                  workingDirectory={environmentWorkingDirectory}
                  onOpenTab={openTab}
                  onRefreshPullRequest={refreshPullRequest}
                />
              </Flexbox>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </OverviewSlot>
  );

  return (
    <>
      {overviewPanel}
      <RightPanel
        collapseThreshold={320}
        defaultWidth={renderWidth}
        expand={Boolean(showRightPanel) && fits}
        maxWidth={maxPanelWidth}
        minWidth={Math.min(Math.max(MIN_PANEL_WIDTH, preferredMinWidth), maxPanelWidth)}
        style={!showRightPanel ? { visibility: 'hidden' } : undefined}
        width={renderWidth}
        onSizeChange={(size) => {
          if (!size?.width) return;
          // The size type allows a string on either axis, so narrow before storing.
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
            {!contentReady && storedTab !== 'files' && activeTab !== 'files' && (
              <DeferredSkeleton />
            )}
            <FilesPane
              active={!!showRightPanel && activeTab === 'files'}
              available={filesAvailable}
              className={styles.pane}
              contentReady={contentReady || (activeTab === 'files' && filesAvailable)}
              deviceId={filesDeviceId}
              directory={filesDirectory}
              prefetch={activeTab === 'files' && (!showRightPanel || !contentReady)}
              sandboxInstanceId={isSandboxExecution ? sandboxInstanceId : undefined}
              sandboxTopicId={sandboxTopicId}
            />
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
                {!!topicId && (
                  <Activity mode={showRightPanel && activeTab === 'search' ? 'visible' : 'hidden'}>
                    <Flexbox className={styles.pane} style={{ overflow: 'hidden' }}>
                      <TopicSearchPane
                        active={!!showRightPanel && activeTab === 'search'}
                        key={topicId}
                        topicId={topicId}
                      />
                    </Flexbox>
                  </Activity>
                )}
                {paramsAvailable && activeTab === 'params' && (
                  <Flexbox className={styles.pane}>
                    <Suspense
                      fallback={<Skeleton.Text className={styles.paramsLoading} rows={6} />}
                    >
                      <ParamsSection />
                    </Suspense>
                  </Flexbox>
                )}
                {reviewAvailable && showRightPanel && fits && activeTab === 'review' && (
                  <Flexbox className={styles.pane}>
                    <Review
                      active
                      composerTarget={composerTarget}
                      deviceId={remoteDeviceId}
                      showTree={showReviewTree}
                      workingDirectory={workingDirectory}
                      onToggleTree={() => setShowReviewTree((v) => !v)}
                    />
                  </Flexbox>
                )}
                {pullRequest && workingDirectory && (
                  <Activity mode={showRightPanel && activeTab === 'pr' ? 'visible' : 'hidden'}>
                    <Flexbox className={styles.pane}>
                      <PullRequest
                        active={!!showRightPanel && activeTab === 'pr'}
                        {...pullRequestLink}
                        deviceId={remoteDeviceId}
                        key={JSON.stringify([remoteDeviceId, workingDirectory, pullRequest.number])}
                        number={pullRequest.number}
                        summary={pullRequest}
                        url={pullRequest.url}
                        workingDirectory={workingDirectory}
                        onOpenTab={openTab}
                      />
                    </Flexbox>
                  </Activity>
                )}
                <DynamicTabPanes
                  activeTab={activeTab}
                  agentId={activeAgentId}
                  browserAvailable={browserAvailable}
                  browserSessionId={browserSessionId}
                  composerTarget={composerTarget}
                  openedTabs={openedTabs}
                  visible={!!showRightPanel}
                  onBrowserMetadataChange={(tab, metadata) => {
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
